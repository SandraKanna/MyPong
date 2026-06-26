import { useEffect } from 'react';
import { sharedRefresh } from '../api/httpClient';

export function useBootstrapAuth(): void {
  useEffect(() => {
    void sharedRefresh();
  }, []);
}
