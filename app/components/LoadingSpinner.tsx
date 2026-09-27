import { C } from "@/config/theme";

// Route / provider loading state. Same calm hairline sweep as the HTML boot screen in
// index.html, so a page goes boot screen → loader → content without a style jump
// (it used to be an off-brand bright-blue spinner). Reduced motion honored.
export const LoadingSpinner = () => (
  <div className="nx-loading" role="status" aria-label="Loading">
    <div className="nx-loading-line" />
    <style>
      {`
        .nx-loading {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100vh;
        }
        .nx-loading-line {
          width: 140px;
          height: 1px;
          background: ${C.border};
          overflow: hidden;
          position: relative;
        }
        .nx-loading-line::after {
          content: "";
          position: absolute;
          top: 0;
          left: -40%;
          width: 40%;
          height: 1px;
          background: ${C.accent};
          opacity: 0.7;
          animation: nx-loading-sweep 1.4s ease-in-out infinite;
        }
        @keyframes nx-loading-sweep { to { left: 100%; } }
        @media (prefers-reduced-motion: reduce) {
          .nx-loading-line::after { animation: none; left: 30%; }
        }
      `}
    </style>
  </div>
);
