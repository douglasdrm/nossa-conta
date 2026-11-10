"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { CategoryItem } from "@/lib/categories";
import { categoryColor } from "@/lib/category-colors";

type Catalog = {
  items: CategoryItem[] | null;
  error: string;
  refresh: () => Promise<void>;
  upsert: (item: CategoryItem, oldName?: string) => void;
  color: (name: string, kind?: string) => string;
};
const Context = createContext<Catalog>({
  items: null,
  error: "",
  refresh: async () => {},
  upsert: () => {},
  color: categoryColor,
});

export function CategoryColorsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CategoryItem[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const response = await fetch("/api/categories", { signal });
      if (!response.ok) throw Error();
      const data: CategoryItem[] = await response.json();
      if (!Array.isArray(data)) throw Error();
      if (!signal?.aborted) setItems(data);
    } catch {
      if (!signal?.aborted)
        setError("Não foi possível carregar as categorias.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const upsert = useCallback((item: CategoryItem, oldName?: string) => {
    setItems((current) => {
      const existing = current?.some(
        (row) => row.kind === item.kind && row.name === (oldName ?? item.name),
      );
      return existing
        ? current!.map((row) =>
            row.kind === item.kind && row.name === (oldName ?? item.name)
              ? item
              : row,
          )
        : [...(current ?? []), item];
    });
  }, []);
  const color = (name: string, kind?: string) =>
    items?.find((item) => item.name === name && (!kind || item.kind === kind))
      ?.color ?? categoryColor(name);
  return (
    <Context.Provider value={{ items, error, refresh: load, upsert, color }}>
      {children}
    </Context.Provider>
  );
}
export const useCategoryColors = () => useContext(Context);
