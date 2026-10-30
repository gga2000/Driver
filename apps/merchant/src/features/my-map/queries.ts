import { useMutation } from '@tanstack/react-query';
import { useApi } from '@/lib/api';

/** «مكاني على الخريطة»: a fix for the team's map inbox (`ops.mapEditor.report`); the map itself changes only after the team checks it. */
export function useReportMyMap() {
  const api = useApi();
  return useMutation(api.ops.mapEditor.report.mutationOptions());
}
