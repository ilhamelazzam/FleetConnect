import { useEffect, useState } from "react";

import { oauthApi, type ApiOAuthProvidersStatus } from "../lib/api";

export function useOAuthProviders() {
  const [providers, setProviders] = useState<ApiOAuthProvidersStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadProviders() {
      try {
        const nextProviders = await oauthApi.providers();
        if (isMounted) {
          setProviders(nextProviders);
        }
      } catch {
        if (isMounted) {
          setProviders(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadProviders();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    isLoading,
    isGoogleConfigured: providers?.google.configured ?? false,
    isMicrosoftConfigured: providers?.microsoft.configured ?? false,
  };
}
