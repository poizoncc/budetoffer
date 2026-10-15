import { createContext, useContext, type ReactNode } from 'react';

export type UiPresentation = 'unified' | 'legacy';

const UiPresentationContext = createContext<UiPresentation>('legacy');

export interface UiPresentationProviderProps {
  presentation: UiPresentation;
  children: ReactNode;
}

/** Scope the shared visual contract to an app or a nested presentation boundary. */
export const UiPresentationProvider = ({
  presentation,
  children,
}: UiPresentationProviderProps) => (
  <UiPresentationContext.Provider value={presentation}>
    {children}
  </UiPresentationContext.Provider>
);

export const useUiPresentation = (
  explicit?: UiPresentation,
): UiPresentation => {
  const inherited = useContext(UiPresentationContext);
  return explicit ?? inherited;
};
