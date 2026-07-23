import React, { createContext, useContext, useEffect, useState } from "react";

export type CartPlugin = {
  key: string;
  kind: "plugin";
  marketplaceItemId: string;
  botId: string;
  botName: string;
  name: string;
  price: number;
};
export type CartBot = {
  key: string;
  kind: "bot";
  name: string;
  token: string;
  description: string;
  price: number;
  /** Set when the bot was added via the /buy-bot tier flow (silver/gold/diamond/custom). */
  tierId?: string;
  tierName?: string;
};
export type CartItem = CartPlugin | CartBot;

type CartContextType = {
  items: CartItem[];
  count: number;
  total: number;
  addPlugin: (p: Omit<CartPlugin, "key" | "kind">) => void;
  addBot: (b: Omit<CartBot, "key" | "kind">) => void;
  remove: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextType | undefined>(undefined);
const STORAGE_KEY = "irforge_cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items]);

  function addPlugin(p: Omit<CartPlugin, "key" | "kind">) {
    const key = `plugin:${p.marketplaceItemId}:${p.botId}`;
    setItems((prev) => (prev.some((i) => i.key === key) ? prev : [...prev, { ...p, key, kind: "plugin" }]));
  }

  function addBot(b: Omit<CartBot, "key" | "kind">) {
    const key = `bot:${b.token.slice(-8)}:${b.name}`;
    setItems((prev) => (prev.some((i) => i.key === key) ? prev : [...prev, { ...b, key, kind: "bot" }]));
  }

  const remove = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));
  const clear = () => setItems([]);

  const total = items.reduce((acc, i) => acc + (i.price || 0), 0);

  return (
    <CartContext.Provider value={{ items, count: items.length, total, addPlugin, addBot, remove, clear }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
