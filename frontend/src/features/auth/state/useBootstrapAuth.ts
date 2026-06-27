import { useEffect } from 'react';
import { sharedRefresh } from '../../../shared/api/httpClient';

export function useBootstrapAuth(): void {
  useEffect(() => {
    void sharedRefresh();
  }, []);
}
