import { FC, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  modal,
  useModal,
  VectorIcon,
} from "@orderly.network/ui";
import { LeftNavProps, LeftNavItem } from "@orderly.network/ui-scaffold";
import { ExternalLink } from "lucide-react";
import { withBasePath } from "@/utils/base-path";
import { groupDrawer } from "@/lib/navGroups.mjs";

type LeftNavUIProps = LeftNavProps &
  {
    className?: string;
    logo?: {
      src: string;
      alt: string;
    };
    externalLinks?: Array<{
      name: string;
      href: string;
      target?: string;
    }>;
  };

const LeftNavUI: FC<LeftNavUIProps> = (props) => {
  const showModal = useCallback(() => {
    modal.show(LeftNavSheet, {
      ...props,
    });
  }, [props]);

  return (
    <button
      onClick={showModal}
      className={props?.className}
      aria-label="Open navigation menu"
      style={{
        zoom: "1.2",
      }}
    >
      <VectorIcon />
    </button>
  );
};

const LeftNavSheet = modal.create<LeftNavUIProps>((props) => {
  const { visible, hide, onOpenChange } = useModal();

  return (
    <Sheet open={visible} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="oui-w-[276px] oui-bg-base-8"
        closeable
        closeableSize={24}
        closeOpacity={0.54}
      >
        <div className="oui-relative oui-flex oui-h-full oui-flex-col oui-gap-3">
          {/* The Nexus lockup — transparent mark (blends seamlessly, no box/border) +
              serif wordmark, congruent with the desktop/mobile header. */}
          <div className="oui-mt-[6px] oui-flex oui-h-[44px] oui-items-center" style={{ gap: 9 }}>
            <img src={withBasePath("/logo-mark.png")} alt="Nexus Trading Labs" className="oui-h-[30px]" style={{ width: "auto", flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--nx-font-serif, 'Libre Baskerville', Georgia, serif)", fontSize: 19, fontWeight: 700, color: "#f4f4f5", letterSpacing: "0.01em", lineHeight: 1 }}>Nexus</span>
          </div>
          
          <div className="oui-flex oui-h-[calc(100vh-120px)] oui-flex-col oui-items-start oui-overflow-y-auto">
            {/* Four groups, Trade / Lab / Social / Rewards (navGroups.mjs). Phone drawer only. */}
            {Array.isArray(props?.menus) && props.menus.length > 0 && (
              <>
                {(groupDrawer(props.menus) as { label: string; items: LeftNavItem[] }[]).map((group, gi) => (
                  <div key={`group-${group.label}`} className="oui-w-full" role="group" aria-label={group.label}>
                    <div
                      className="oui-px-3"
                      style={{ paddingTop: gi === 0 ? 4 : 14, paddingBottom: 2, fontFamily: "var(--nx-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#71717a", borderTop: gi === 0 ? "none" : "1px solid #232327", marginTop: gi === 0 ? 0 : 6 }}
                    >
                      {group.label}
                    </div>
                    {group.items.map((item) => (
                      <NavItem
                        item={item}
                        key={`item-${item.name}`}
                        onLinkClick={hide}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
            
            {Array.isArray(props?.externalLinks) && props.externalLinks.length > 0 && (
              <>
                <div className="oui-w-full oui-border-t oui-border-line-12 oui-my-2 oui-bg-base-3"></div>
                {props.externalLinks?.map((item) => (
                  <ExternalNavItem
                    item={item}
                    key={`external-${item.name}`}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});

type NavItemProps = {
  item: LeftNavItem;
  onLinkClick?: () => void;
};

const NavItem: FC<NavItemProps> = ({ item, onLinkClick }) => {
  const { href, name, icon, trailing } = item;
  return (
    <Link
      to={href}
      onClick={onLinkClick}
      className="oui-flex oui-items-center oui-px-3 oui-w-full hover:oui-bg-base-7 oui-no-underline"
      style={{ paddingTop: 10, paddingBottom: 10 }}
    >
      <div>{icon}</div>
      <div className="oui-text-base oui-font-semibold oui-text-base-contrast-80">
        {name}
      </div>
      {trailing}
    </Link>
  );
};

type ExternalNavItemProps = {
  item: {
    name: string;
    href: string;
    target?: string;
  };
};

const ExternalNavItem: FC<ExternalNavItemProps> = ({ item }) => {
  return (
    <a
      href={item.href}
      target={item.target || "_blank"}
      rel="noopener noreferrer"
      className="oui-flex oui-items-center oui-justify-between oui-px-3 oui-py-4 oui-w-full hover:oui-bg-base-7 oui-no-underline"
    >
      <div className="oui-text-base oui-font-semibold oui-text-base-contrast-80">
        {item.name}
      </div>
      <ExternalLink className="oui-w-4 oui-h-4 oui-text-base-contrast-54 oui-flex-shrink-0" />
    </a>
  );
};

export default LeftNavUI;
