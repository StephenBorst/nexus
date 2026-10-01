import { ReactNode } from 'react';
import { WalletConnectorPrivyProvider, Network } from '@orderly.network/wallet-connector-privy';
import type { NetworkId } from "@orderly.network/types";
import { QueryClient } from "@tanstack/query-core";
import { getEvmConnectors, getSolanaConfig } from '../../utils/walletConfig';
import { getRuntimeConfig, getRuntimeConfigBoolean } from '@/utils/runtime-config';

// Privy warns on every load that Solana login is on but no Solana connectors were passed to
// `config.externalWallets.solana.connectors`. It's noise for us: Orderly's connector handles
// Solana wallets itself (Phantom login tested by borst 2026-10-01: works, no errors). Drop
// ONLY that one message; every other warning still prints.
const PRIVY_SOLANA_CONNECTORS_WARNING = "App configuration has Solana wallet login enabled, but no Solana wallet connectors";
if (typeof console !== "undefined" && !(console.warn as { nxFiltered?: boolean }).nxFiltered) {
  const warn = console.warn.bind(console);
  const filtered = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith(PRIVY_SOLANA_CONNECTORS_WARNING)) return;
    warn(...args);
  };
  (filtered as { nxFiltered?: boolean }).nxFiltered = true;
  console.warn = filtered;
}

type LoginMethod ="email" | "passkey" | "twitter" | "google";

const getLoginMethods = (): LoginMethod[] => {
  const loginMethodsEnv = getRuntimeConfig('VITE_PRIVY_LOGIN_METHODS');
  if (!loginMethodsEnv) {
    return ['email'];
  }
  
  const validMethods: LoginMethod[] = ["email", "passkey", "twitter", "google"];
  
  return loginMethodsEnv.split(',')
    .map((method: string) => method.trim())
    .filter((method: string): method is LoginMethod => 
      validMethods.includes(method as LoginMethod)
    );
};

const PrivyConnector = ({ children, networkId }: {
  children: ReactNode;
  networkId: NetworkId;
}) => {
  const appId = getRuntimeConfig('VITE_PRIVY_APP_ID');
  if (!appId) {
    throw new Error(`VITE_PRIVY_APP_ID not set`)
  }
  const termsOfUseUrl = getRuntimeConfig('VITE_PRIVY_TERMS_OF_USE');
  const enableAbstractWallet = getRuntimeConfigBoolean('VITE_ENABLE_ABSTRACT_WALLET');
  const disableEVMWallets = getRuntimeConfigBoolean('VITE_DISABLE_EVM_WALLETS');
  const disableSolanaWallets = getRuntimeConfigBoolean('VITE_DISABLE_SOLANA_WALLETS');
  const loginMethods = getLoginMethods();

  return (
    <WalletConnectorPrivyProvider
      network={networkId === 'mainnet' ? Network.mainnet : Network.testnet}
      termsOfUse={termsOfUseUrl}
      wagmiConfig={disableEVMWallets ? undefined : {
        connectors: getEvmConnectors()
      }}
      solanaConfig={disableSolanaWallets ? undefined : getSolanaConfig(networkId)}
      privyConfig={{
        config: {
          appearance: {
            showWalletLoginFirst: false,
          },
          loginMethods: loginMethods,
        },
        appid: appId,
      }}
      abstractConfig={enableAbstractWallet ? {
        queryClient: new QueryClient(),
      } : undefined}
    >
      {children}
    </WalletConnectorPrivyProvider>
  );
};

export default PrivyConnector; 