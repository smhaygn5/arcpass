import { TeamApprovalPanel } from "@/components/TeamApprovalPanel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Team Approval",
};

export default async function ApprovalPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return <TeamApprovalPanel requestId={requestId} />;
}
