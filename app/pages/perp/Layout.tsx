import { Outlet } from "react-router-dom";
import { Scaffold } from "@orderly.network/ui-scaffold";
import { useOrderlyConfig } from "@/utils/config";
import { useNav } from "@/hooks/useNav";
import LabPulseChip from "@/components/LabPulseChip";
import PositionCallButton from "@/components/PositionCallButton";

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
      <Outlet />
    </Scaffold>
  );
}

