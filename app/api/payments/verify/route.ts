import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";
import { arcTestnet } from "@/lib/arc-chain";
import {
  ARCPASS_TOKENS,
  decodeInvoicePayload,
  invoiceAmountRaw,
  paymentReceiptUrl,
} from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import type { VerifiedReceiptPayload } from "@/lib/receipts";
import { findServerInvoiceByPayload } from "@/lib/server-invoices";
import {
  findServerReceiptByTxHash,
  ReceiptAssignmentConflictError,
  saveServerReceipt,
} from "@/lib/server-receipts";

export const runtime = "nodejs";

const transferEventAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

type VerifyPaymentBody = {
  payer?: unknown;
  payload?: unknown;
  txHash?: unknown;
};

type TransferArgs = {
  from?: Address;
  to?: Address;
  value?: bigint;
};

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`payment:${clientKey(req)}`, 24, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = (await req.json().catch(() => null)) as VerifyPaymentBody | null;
  const payload = typeof body?.payload === "string" ? body.payload : "";
  const txHash = typeof body?.txHash === "string" ? body.txHash : "";
  const invoice = decodeInvoicePayload(payload);

  if (!invoice) {
    return NextResponse.json({ error: "Payment link payload is invalid." }, { status: 400 });
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Transaction hash is invalid." }, { status: 400 });
  }

  const payer =
    typeof body?.payer === "string" && isAddress(body.payer)
      ? getAddress(body.payer)
      : null;
  const token = ARCPASS_TOKENS[invoice.token];
  const expectedAmount = invoiceAmountRaw(invoice);
  const expectedMerchant = getAddress(invoice.merchant.walletAddress);

  try {
    const registeredInvoice = await findServerInvoiceByPayload({
      invoiceId: invoice.invoiceId,
      merchant: expectedMerchant,
      payload,
    });

    if (!registeredInvoice) {
      return NextResponse.json(
        {
          error: "This payment link is not registered by ArcPass. Ask the merchant for a new verified link.",
          verified: false,
        },
        { status: 409 },
      );
    }

    const assignedReceipt = await findServerReceiptByTxHash(txHash);
    if (assignedReceipt && assignedReceipt.invoiceId !== invoice.invoiceId) {
      return transactionAssignmentConflict(txHash);
    }

    if (assignedReceipt) {
      return NextResponse.json({
        amount: assignedReceipt.amount,
        blockNumber: assignedReceipt.blockNumber,
        explorerUrl: assignedReceipt.explorerUrl,
        invoiceId: assignedReceipt.invoiceId,
        merchant: assignedReceipt.merchant,
        payer: assignedReceipt.payer,
        serverSaved: true,
        token: assignedReceipt.token,
        txHash: assignedReceipt.txHash,
        verified: true,
      });
    }

    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hash });

    if (receipt.status !== "success") {
      return NextResponse.json(
        {
          error: "Transaction was found, but it did not succeed.",
          explorerUrl: paymentReceiptUrl(txHash),
          verified: false,
        },
        { status: 409 },
      );
    }

    const transferLogs = parseEventLogs({
      abi: transferEventAbi,
      eventName: "Transfer",
      logs: receipt.logs,
      strict: false,
    });
    const matchedTransfer = transferLogs.find((log) => {
      const args = log.args as TransferArgs;

      if (getAddress(log.address) !== getAddress(token.address)) return false;
      if (!args.to || getAddress(args.to) !== expectedMerchant) return false;
      if (args.value !== expectedAmount) return false;
      if (payer && (!args.from || getAddress(args.from) !== payer)) return false;
      return true;
    });

    if (!matchedTransfer) {
      return NextResponse.json(
        {
          error: "Transaction does not match this invoice amount, token, and merchant.",
          explorerUrl: paymentReceiptUrl(txHash),
          verified: false,
        },
        { status: 409 },
      );
    }

    const args = matchedTransfer.args as TransferArgs;
    const actualPayer = args.from ? getAddress(args.from) : getAddress(receipt.from);

    if (actualPayer === expectedMerchant) {
      return NextResponse.json(
        {
          error: "Payer and merchant are the same wallet. This is a self-payment test, not a buyer receipt.",
          explorerUrl: paymentReceiptUrl(txHash),
          selfPayment: true,
          verified: false,
        },
        { status: 409 },
      );
    }

    const verifiedReceipt: VerifiedReceiptPayload = {
      amount: invoice.amount,
      blockNumber: receipt.blockNumber.toString(),
      explorerUrl: paymentReceiptUrl(txHash),
      invoiceId: invoice.invoiceId,
      merchant: expectedMerchant,
      payer: actualPayer,
      token: invoice.token,
      txHash: txHash as Hash,
      verified: true,
    };
    let serverSaved = false;

    try {
      await saveServerReceipt({
        invoice,
        origin: requestOrigin(req),
        payload,
        receipt: verifiedReceipt,
      });
      serverSaved = true;
    } catch (err) {
      if (err instanceof ReceiptAssignmentConflictError) {
        return transactionAssignmentConflict(txHash);
      }
      serverSaved = false;
    }

    return NextResponse.json({ ...verifiedReceipt, serverSaved });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Payment verification failed.",
        explorerUrl: paymentReceiptUrl(txHash),
        verified: false,
      },
      { status: 404 },
    );
  }
}

function transactionAssignmentConflict(txHash: string) {
  return NextResponse.json(
    {
      error: "This transaction is already assigned to another ArcPass invoice.",
      explorerUrl: paymentReceiptUrl(txHash),
      verified: false,
    },
    { status: 409 },
  );
}

function requestOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");

  return host ? `${protocol}://${host}` : req.nextUrl.origin;
}
