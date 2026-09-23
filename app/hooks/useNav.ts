import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { RouteOption } from "@orderly.network/types";
import { getSymbol } from "@/utils/storage";

export function useNav() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const onRouteChange = useCallback(
    (option?: RouteOption) => {
      // The Orderly scaffold's mobile back chevron calls onRouteChange(undefined)
      // for pages that aren't registered main menus (e.g. /analyze, /arena: their
      // initialMenu matches nothing in mainMenus, so the scaffold treats them as
      // sub-pages and its onBack finds no target). Reading option.href used to
      // throw here, so the button silently did nothing. Treat it as a real back:
      // step back through history when there is any, otherwise land on home
      // (which redirects to the trading page).
      if (!option || typeof option.href !== "string") {
        if (typeof window !== "undefined" && window.history.length > 1) {
          navigate(-1);
        } else {
          navigate("/");
        }
        return;
      }

      const searchParamsString = searchParams.toString();
      const queryString = searchParamsString ? `?${searchParamsString}` : "";

      if (option.target === "_blank") {
        window.open(option.href);
        return;
      }

      if (option.href === "/") {
        const symbol = getSymbol();
        navigate(`/perp/${symbol}${queryString}`);
        return;
      }

      const routeMap = {
        //   "/portfolio": "/portfolio",
        "/portfolio/feeTier": "/portfolio/fee",
        "/portfolio/apiKey": "/portfolio/api-key",
        //   "/portfolio/positions": "/portfolio/positions",
        //   "/portfolio/orders": "/portfolio/orders",
        //   "/portfolio/setting": "/portfolio/setting",
      } as Record<string, string>;

      const path = routeMap[option.href] || option.href;

      navigate(`${path}${queryString}`);
    },
    [navigate, searchParams]
  );

  return { onRouteChange };
}
