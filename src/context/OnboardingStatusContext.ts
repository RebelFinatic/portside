import { createContext } from 'react';

export const OnboardingStatusContext = createContext({
  refreshOnboardingStatus: async () => {},
});
