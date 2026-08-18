"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { paymentQrFilename } from "@/lib/payment-link-kit";

export function PaymentLinkQr({
  invoiceId,
  paymentLink,
}: {
  invoiceId: string;
  paymentLink: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void QRCode.toCanvas(canvas, paymentLink, {
      color: { dark: "#111827", light: "#ffffff" },
      errorCorrectionLevel: "M",
      margin: 1,
      width: 188,
    }).catch(() => setMessage("QR preview could not be generated."));
  }, [paymentLink]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(paymentLink);
      setMessage("Payment link copied.");
    } catch {
      setMessage("Copy the payment link from the invoice detail above.");
    }
  }

  async function shareLink() {
    try {
      if (navigator.share) {
        await navigator.share({
          text: "Open this verified ArcPass checkout.",
          title: `ArcPass invoice ${invoiceId}`,
          url: paymentLink,
        });
        setMessage("Payment link shared.");
        return;
      }
      await copyLink();
    } catch {
      setMessage("Sharing was cancelled.");
    }
  }

  function downloadQr() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const anchor = document.createElement("a");
    anchor.download = paymentQrFilename(invoiceId);
    anchor.href = canvas.toDataURL("image/png");
    anchor.click();
    setMessage("QR image download started.");
  }

  return (
    <section className="arcpass-payment-qr" aria-label="Payment link QR kit">
      <div className="arcpass-payment-qr-code">
        <canvas ref={canvasRef} aria-label={`QR code for invoice ${invoiceId}`} />
      </div>
      <div>
        <p className="arcpass-panel-label">Payment Link QR Kit</p>
        <h4>Scan, share, or print checkout.</h4>
        <p className="arcpass-muted">The code opens this exact server-backed payment link.</p>
        <div className="arcpass-payment-qr-actions">
          <button type="button" onClick={() => void copyLink()} className="arcpass-ghost-button">Copy</button>
          <button type="button" onClick={() => void shareLink()} className="arcpass-ghost-button">Share</button>
          <button type="button" onClick={downloadQr} className="arcpass-dark-button">Download QR</button>
        </div>
        {message ? <p className="arcpass-payment-qr-message" role="status">{message}</p> : null}
      </div>
    </section>
  );
}
