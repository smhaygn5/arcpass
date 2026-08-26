"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { shortAddress } from "@/lib/format";
import {
  TEAM_ROLE_CAPABILITIES,
  approvalStatusLabel,
  defaultTeamWorkspace,
  isApprovalRequestView,
  normalizeTeamWorkspace,
  roleLabel,
  type ApprovalRequestView,
  type TeamRole,
  type TeamWorkspace,
} from "@/lib/team-policies";

export function TeamAccessCenter({ refreshKey, walletAddress }: { refreshKey: number; walletAddress: Address | null }) {
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [memberLabel, setMemberLabel] = useState("");
  const [memberRole, setMemberRole] = useState<TeamRole>("approver");
  const [memberWallet, setMemberWallet] = useState("");
  const [requests, setRequests] = useState<ApprovalRequestView[]>([]);
  const [saved, setSaved] = useState(false);
  const [workspace, setWorkspace] = useState<TeamWorkspace | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!walletAddress) {
      setWorkspace(null);
      setRequests([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [teamRes, approvalRes] = await Promise.all([
        fetch(`/api/team?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" }),
        fetch(`/api/approvals?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" }),
      ]);
      const teamBody = (await teamRes.json().catch(() => null)) as { error?: string; workspace?: unknown } | null;
      const approvalBody = (await approvalRes.json().catch(() => null)) as { error?: string; requests?: unknown[] } | null;
      if (!teamRes.ok) throw new Error(teamBody?.error || "Team workspace could not be loaded.");
      if (!approvalRes.ok) throw new Error(approvalBody?.error || "Approval queue could not be loaded.");
      setWorkspace(normalizeTeamWorkspace(teamBody?.workspace, walletAddress));
      setRequests((approvalBody?.requests ?? []).filter(isApprovalRequestView));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Team workspace could not be loaded.");
      setWorkspace(defaultTeamWorkspace(walletAddress));
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace, refreshKey]);

  const approverCount = useMemo(() => 1 + (workspace?.members.filter((member) => member.role === "approver").length ?? 0), [workspace]);
  const pendingCount = requests.filter((request) => request.status === "pending").length;

  function addMember() {
    setError(null);
    setSaved(false);
    if (!workspace || !walletAddress) return;
    if (!isAddress(memberWallet)) { setError("Enter a valid EVM wallet address for the team member."); return; }
    const address = getAddress(memberWallet);
    if (address.toLowerCase() === walletAddress.toLowerCase() || workspace.members.some((member) => member.walletAddress.toLowerCase() === address.toLowerCase())) {
      setError("This wallet is already part of the workspace.");
      return;
    }
    if (!memberLabel.trim()) { setError("Add a short name for the team member."); return; }
    setWorkspace({ ...workspace, members: [...workspace.members, { addedAt: new Date().toISOString(), label: memberLabel.trim(), role: memberRole, walletAddress: address }] });
    setMemberLabel("");
    setMemberWallet("");
  }

  async function saveWorkspace() {
    if (!workspace || !walletAddress) return;
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      const res = await fetch("/api/team", { body: JSON.stringify({ members: workspace.members, merchant: walletAddress, policy: workspace.policy }), headers: { "content-type": "application/json" }, method: "PUT" });
      const body = (await res.json().catch(() => null)) as { error?: string; saved?: boolean; workspace?: unknown } | null;
      if (!res.ok || body?.saved !== true) throw new Error(body?.error || "Team policy could not be saved.");
      setWorkspace(normalizeTeamWorkspace(body.workspace, walletAddress));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Team policy could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyApprovalLink(requestId: string) {
    await window.navigator.clipboard.writeText(`${window.location.origin}/approve/${requestId}`);
    setCopiedRequestId(requestId);
  }

  if (!walletAddress) return <section className="arcpass-panel arcpass-team-center"><div className="arcpass-team-empty"><span aria-hidden="true">◎</span><div><strong>Connect the owner wallet to configure team access.</strong><p>Team policies are stored against the merchant wallet and protected by the signed merchant session.</p></div></div></section>;
  if (!workspace) return <section className="arcpass-panel"><p className="arcpass-muted">{isLoading ? "Loading team workspace." : "Team workspace unavailable."}</p></section>;

  return (
    <section className="arcpass-panel arcpass-team-center">
      <div className="arcpass-team-heading">
        <div><p className="arcpass-panel-label">Team roles & approval policies</p><h3>Separate invoice preparation from high-value approval.</h3><p>Role assignments are wallet-bound. Approval signatures are gas-free and never grant token or payment permissions.</p></div>
        <button type="button" className="arcpass-ghost-button" onClick={() => void loadWorkspace()} disabled={isLoading}>{isLoading ? "Refreshing" : "Refresh"}</button>
      </div>

      <div className="arcpass-team-metrics">
        <TeamMetric label="Members" value={String(workspace.members.length + 1)} detail="Owner included" />
        <TeamMetric label="Approvers" value={String(approverCount)} detail="Wallets eligible to sign" tone="primary" />
        <TeamMetric label="Pending" value={String(pendingCount)} detail="Operations waiting" tone={pendingCount ? "caution" : "neutral"} />
        <TeamMetric label="Policy" value={workspace.policy.enabled ? `${workspace.policy.requiredApprovals} signature${workspace.policy.requiredApprovals === 1 ? "" : "s"}` : "Off"} detail="For threshold operations" tone={workspace.policy.enabled ? "success" : "neutral"} />
      </div>

      <div className="arcpass-team-grid">
        <section className="arcpass-team-section">
          <div className="arcpass-team-section-head"><div><span>Workspace members</span><strong>Wallet-bound roles</strong></div><small>{workspace.members.length + 1}/13 seats</small></div>
          <div className="arcpass-team-members">
            <article><span className="arcpass-team-avatar">O</span><div><strong>Workspace owner</strong><small>{shortAddress(walletAddress)}</small></div><em>Owner</em></article>
            {workspace.members.map((member) => (
              <article key={member.walletAddress}>
                <span className="arcpass-team-avatar">{member.label.slice(0, 1).toUpperCase()}</span>
                <div><strong>{member.label}</strong><small>{shortAddress(member.walletAddress)}</small></div>
                <select aria-label={`Role for ${member.label}`} value={member.role} onChange={(event) => { setSaved(false); setWorkspace({ ...workspace, members: workspace.members.map((candidate) => candidate.walletAddress === member.walletAddress ? { ...candidate, role: event.target.value as TeamRole } : candidate) }); }}>
                  <option value="approver">Approver</option><option value="billing">Billing</option><option value="viewer">Viewer</option>
                </select>
                <button type="button" aria-label={`Remove ${member.label}`} onClick={() => { setSaved(false); setWorkspace({ ...workspace, members: workspace.members.filter((candidate) => candidate.walletAddress !== member.walletAddress) }); }}>×</button>
              </article>
            ))}
          </div>
          <div className="arcpass-team-add">
            <input aria-label="Team member name" value={memberLabel} onChange={(event) => setMemberLabel(event.target.value)} placeholder="Member name" />
            <input aria-label="Team member wallet" value={memberWallet} onChange={(event) => setMemberWallet(event.target.value)} placeholder="0x wallet address" />
            <select aria-label="New team member role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamRole)}><option value="approver">Approver</option><option value="billing">Billing</option><option value="viewer">Viewer</option></select>
            <button type="button" className="arcpass-ghost-button" onClick={addMember}>Add member</button>
          </div>
        </section>

        <section className="arcpass-team-section arcpass-policy-builder">
          <div className="arcpass-team-section-head"><div><span>Approval policy</span><strong>High-value invoice guard</strong></div><label className="arcpass-policy-switch"><input type="checkbox" checked={workspace.policy.enabled} onChange={(event) => { setSaved(false); setWorkspace({ ...workspace, policy: { ...workspace.policy, enabled: event.target.checked } }); }} /><span>{workspace.policy.enabled ? "Enabled" : "Disabled"}</span></label></div>
          <p>ArcPass aggregates invoices by token. If a batch reaches either threshold, registration pauses until the signature quorum is met.</p>
          <div className="arcpass-policy-fields">
            <label><span>USDC threshold</span><input inputMode="decimal" value={workspace.policy.thresholds.USDC} onChange={(event) => { setSaved(false); setWorkspace({ ...workspace, policy: { ...workspace.policy, thresholds: { ...workspace.policy.thresholds, USDC: event.target.value } } }); }} /></label>
            <label><span>EURC threshold</span><input inputMode="decimal" value={workspace.policy.thresholds.EURC} onChange={(event) => { setSaved(false); setWorkspace({ ...workspace, policy: { ...workspace.policy, thresholds: { ...workspace.policy.thresholds, EURC: event.target.value } } }); }} /></label>
            <label><span>Required approvals</span><select value={workspace.policy.requiredApprovals} onChange={(event) => { setSaved(false); setWorkspace({ ...workspace, policy: { ...workspace.policy, requiredApprovals: Number(event.target.value) } }); }}>{[1, 2, 3].filter((count) => count <= approverCount).map((count) => <option key={count} value={count}>{count} signature{count === 1 ? "" : "s"}</option>)}</select></label>
          </div>
          <button type="button" className="arcpass-dark-button" onClick={() => void saveWorkspace()} disabled={isSaving}>{isSaving ? "Saving policy" : "Save team & policy"}</button>
          {saved ? <p className="arcpass-success">Team roles and approval thresholds saved.</p> : null}
          {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
        </section>
      </div>

      <section className="arcpass-role-matrix">
        <div><p className="arcpass-panel-label">Permission map</p><h3>Clear responsibility by role.</h3></div>
        <div>{(["owner", "approver", "billing", "viewer"] as const).map((role) => <article key={role}><strong>{roleLabel(role)}</strong>{TEAM_ROLE_CAPABILITIES[role].map((capability) => <span key={capability}>✓ {capability}</span>)}</article>)}</div>
      </section>
      <p className="arcpass-team-disclosure">The Approver role is enforced by wallet signature on shared review links. Billing and Viewer are responsibility labels in this release and never grant signing or policy-management rights.</p>

      <section className="arcpass-approval-queue">
        <div className="arcpass-team-section-head"><div><span>Approval queue</span><strong>Operations waiting for wallet signatures</strong></div><small>{requests.length} total</small></div>
        {requests.length ? <div className="arcpass-approval-list">{requests.map((request) => (
          <article key={request.requestId} data-status={request.status}>
            <div><span>{approvalStatusLabel(request.status)}</span><strong>{request.operationLabel}</strong><small>{request.requestId} · expires {new Date(request.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</small></div>
            <div>{Object.entries(request.totals).map(([token, total]) => <strong key={token}>{total} {token}</strong>)}<small>{request.approvals.length}/{request.requiredApprovals} signatures</small></div>
            <button type="button" className="arcpass-ghost-button" disabled={request.status !== "pending"} onClick={() => void copyApprovalLink(request.requestId)}>{copiedRequestId === request.requestId ? "Review link copied" : request.status === "pending" ? "Copy review link" : approvalStatusLabel(request.status)}</button>
          </article>
        ))}</div> : <div className="arcpass-team-empty"><span aria-hidden="true">✓</span><div><strong>No approval requests yet.</strong><p>When an invoice operation reaches a saved threshold, it will appear here before registration.</p></div></div>}
      </section>
    </section>
  );
}

function TeamMetric({ detail, label, tone = "neutral", value }: { detail: string; label: string; tone?: "caution" | "neutral" | "primary" | "success"; value: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
