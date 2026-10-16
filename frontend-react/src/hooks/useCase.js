import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { useRemote } from "./useRemote";
import { casesApi } from "../api/cases";
export function useCase() {
  const { id } = useParams();
  return useRemote(useCallback(() => casesApi.get(id), [id]));
}
