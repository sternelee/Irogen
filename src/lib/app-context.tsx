import { createContext, useContext, type ReactNode } from "react";

export type IrogenAppContext = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(
    event: string,
    handler: (payload: T) => void
  ) => Promise<() => void>;
  deviceInfo: {
    os: string;
    platform: string;
    isMobile: boolean;
  };
};

const AppContext = createContext<IrogenAppContext | null>(null);

export function AppContextProvider(props: {
  value: IrogenAppContext;
  children: ReactNode;
}) {
  return (
    <AppContext.Provider value={props.value}>
      {props.children}
    </AppContext.Provider>
  );
}

export function useAppContext(): IrogenAppContext {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
}
