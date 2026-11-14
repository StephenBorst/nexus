import { Outlet } from "react-router-dom";
import { Scaffold } from "@orderly.network/ui-scaffold";
import { useOrderlyConfig } from "@/utils/config";
import { useNav } from "@/hooks/useNav";
import LabPulseChip from "@/components/LabPulseChip";
import PositionCallButton from "@/components/PositionCallButton";
import MarketStripBar from "@/components/MarketStripBar";

export default function PerpLayout() {
  const config = useOrderlyConfig();
  const { onRouteChange } = useNav();

  return (
    <Scaffold
      mainNavProps={config.scaffold.mainNavProps}
      footerProps={config.scaffold.footerProps}
      routerAdapter={{
        onRouteChange,
        currentPath: "/",
      }}
      bottomNavProps={config.scaffold.bottomNavProps}
    >
      <LabPulseChip trailing={<PositionCallButton />} />
      {/* The read on the market on screen, one line; tap → the drawer with every lens and its grade. */}
      <MarketStripBar />
      <Outlet />
    </Scaffold>
  );
}

