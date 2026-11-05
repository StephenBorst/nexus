// "Other chains" — a third tab in Orderly's own Deposit / Withdraw window, next to Deposit.
// An Orderly plugin interceptor on the SDK's injectable "Transfer.DepositAndWithdraw": it renders the
// original window unchanged and only adds one entry to its `extraTabs` (withFundTab, tested). The tab
// moves nothing itself: it closes the window and opens Spot's cross-chain card in "Fund my trading
// account" mode, where the transfer is quoted, checked and proven on-chain before the deposit.
import type { ComponentType, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { C } from "@/config/theme";
import { withFundTab, XC_FUND_INTERCEPT_TARGET } from "@/lib/xcFundTab.mjs";

type Tab = { id: string; title: string; icon: ReactNode; component: ComponentType<{ close?: () => void }>; order?: number };
type WindowProps = { activeTab?: string; close?: () => void; extraTabs?: Tab[] };

function OtherChainsTab({ close }: { close?: () => void }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px 8px" }}>
      <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 15, fontWeight: 600, color: C.text.bright }}>Funds on another chain?</div>
      <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 13, lineHeight: 1.55, color: C.text.fog }}>
        Solana, Base, Ethereum. Move them in as USDC with one verified transfer.
        <br />
        Delivery is checked on-chain. Then deposit here.
      </div>
      <button type="button"
        onClick={() => { close?.(); navigate("/token", { state: { xcFund: true } }); }}
        style={{ alignSelf: "flex-start", background: C.accent, color: C.canvas, border: `1px solid ${C.accent}`, borderRadius: 10, fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 13.5, fontWeight: 600, padding: "10px 16px", cursor: "pointer" }}>
        Move funds in
      </button>
      <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: 11.5, color: C.text.faint }}>Via NEAR Intents. One transfer, no approval. Refunds go to your own wallet.</div>
    </div>
  );
}

const icon = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
    <path d="M2 5h9m0 0L8 2m3 3L8 8M14 11H5m0 0l3-3m-3 3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const xcDepositPlugin = {
  id: "nexus-xc-deposit",
  name: "Nexus · deposit from other chains",
  interceptors: [{
    target: XC_FUND_INTERCEPT_TARGET,
    component: (Original: ComponentType<WindowProps>, props: WindowProps) => (
      <Original {...props} extraTabs={withFundTab(props.extraTabs, { id: "", title: "Other chains", icon, component: OtherChainsTab, order: 90 }) as Tab[]} />
    ),
  }],
};
