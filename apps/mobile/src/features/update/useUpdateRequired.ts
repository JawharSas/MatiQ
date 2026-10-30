/**
 * Whether this app version is still allowed (neon/migrations/20261101000300_app_requirements.sql),
 * from the function's `app-requirements` route, which answers signed out too.
 * When it can't be read (offline, server trouble) the app carries on, so a
 * failed check never locks anyone out.
 */

import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { backend } from '@/lib/backend';
import { isOlderThan } from './version';

interface Requirements {
  min_version: string;
  download_url: string;
}

export const APP_VERSION = Constants.expoConfig?.version ?? null;

export function useUpdateRequired(): { required: false } | { required: true; downloadUrl: string } {
  const query = useQuery({
    queryKey: ['app-requirements'],
    queryFn: async () => {
      const { data, error } = await backend.functions.invoke<Requirements>('app-requirements', { method: 'GET' });
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const requirements = query.data;
  if (!requirements || !isOlderThan(APP_VERSION, requirements.min_version)) return { required: false };
  return { required: true, downloadUrl: requirements.download_url };
}
