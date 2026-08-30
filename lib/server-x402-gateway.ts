import "server-only";

import { BatchFacilitatorClient, GatewayEvmScheme } from "@circle-fin/x402-batching/server";
import { x402HTTPResourceServer, x402ResourceServer, type FacilitatorClient, type HTTPAdapter, type HTTPRequestContext } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import type { NextRequest } from "next/server";
import { ARC_X402_FACILITATOR, ARC_X402_NETWORK, type X402Resource } from "./x402.ts";

const facilitator = new BatchFacilitatorClient({ url: ARC_X402_FACILITATOR });
const resourceServer = new x402ResourceServer(facilitator as unknown as FacilitatorClient)
  .register(ARC_X402_NETWORK as Network, new GatewayEvmScheme());
let initialization: Promise<void> | null = null;

export async function createArcX402RequestServer(req: NextRequest, resource: X402Resource) {
  if (!initialization) {
    initialization = resourceServer.initialize().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;

  const path = req.nextUrl.pathname;
  const server = new x402HTTPResourceServer(resourceServer, {
    [`GET ${path}`]: {
      accepts: {
        maxTimeoutSeconds: 604_900,
        network: ARC_X402_NETWORK as Network,
        payTo: resource.merchant,
        price: `$${resource.price}`,
        scheme: "exact",
      },
      description: resource.description,
      mimeType: "application/json",
      resource: req.nextUrl.toString(),
      serviceName: resource.title,
      tags: ["arc", "usdc", "x402", "nanopayment"],
      unpaidResponseBody: () => ({
        body: {
          error: "PAYMENT-SIGNATURE header is required",
          price: `${resource.price} USDC`,
          protocol: "x402 v2",
          resourceId: resource.resourceId,
        },
        contentType: "application/json",
      }),
    },
  });

  const adapter: HTTPAdapter = {
    getAcceptHeader: () => req.headers.get("accept") ?? "application/json",
    getHeader: (name) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => path,
    getUrl: () => req.nextUrl.toString(),
    getUserAgent: () => req.headers.get("user-agent") ?? "",
  };
  const context: HTTPRequestContext = {
    adapter,
    method: req.method,
    path,
    paymentHeader: req.headers.get("payment-signature") ?? undefined,
    routePattern: `GET ${path}`,
  };
  return { context, server };
}
