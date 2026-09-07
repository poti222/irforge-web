import { useMemo, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AmountInput } from "@/components/ui/amount-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { formatToman } from "@/lib/format";
import type { Product, ProductCategory } from "@/hooks/use-products";

/**
 * ProductsManager.tsx — IRFORGE_PRODUCTS_PHASES_3_TO_6_PROMPT Phase 4.
 *
 * Same structure as PlansManager.tsx (dialog-based create/edit, AlertDialog
 * delete confirm, plain customFetch + useQuery, no locale-file strings —
 * this codebase's admin manager components are all fa/en-inline, never
 * useT-driven; matched here rather than inventing a new convention).
 *
 * The one thing every other manager here doesn't have: the "bot" category's
 * product roster is fixed at exactly Standard/Pro (routes/products.ts's
 * isBotCategoryId()/botCategoryPatchViolation() enforce this server-side —
 * see PROGRESS.md). This component enforces the same rule in the UI so an
 * admin sees *why* a button is missing instead of just getting a 403: no
 * "New product" while viewing the bot category, no delete button on a bot
 * product row, and the edit dialog locks every field but price for one.
 */

const BOT_CATEGORY_ID = "bot";

export const ADMIN_PRODUCTS_KEY = ["admin-products"] as const;
export const ADMIN_PRODUCT_CATEGORIES_KEY = ["admin-product-categories"] as const;

const PRODUCT_ICON_NAMES = ["Bot", "CreditCard", "Wallet", "Code", "Calculator", "School", "Medal", "Trophy", "Settings2"];

type ProductFormState = {
  id: string | null;
  categoryId: string;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  price: string;
  isActive: boolean;
  icon: string;
  sortOrder: string;
  metadataText: string;
};

const EMPTY_PRODUCT: ProductFormState = {
  id: null, categoryId: "", name: "", nameFa: "", description: "", descriptionFa: "",
  price: "0", isActive: true, icon: "", sortOrder: "0", metadataText: "{}",
};

type CategoryFormState = {
  id: string | null;
  labelFa: string;
  labelEn: string;
  icon: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY_CATEGORY: CategoryFormState = {
  id: null, labelFa: "", labelEn: "", icon: "", sortOrder: "0", isActive: true,
};

export function ProductsManager() {
  const { lang } = useLanguage();
  const fa = lang === "fa";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ADMIN_PRODUCT_CATEGORIES_KEY,
    queryFn: () => customFetch<ProductCategory[]>("/api/admin/product-categories"),
  });
  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ADMIN_PRODUCTS_KEY,
    queryFn: () => customFetch<Product[]>("/api/admin/products"),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCTS_KEY });
    queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCT_CATEGORIES_KEY });
    // برای این‌که صفحه‌ی عمومیِ /products هم بلافاصله به‌روز شود، نه فقط پنلِ ادمین.
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
  };

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const filteredProducts = useMemo(
    () => (products ?? []).filter((p) => categoryFilter === "all" || p.categoryId === categoryFilter),
    [products, categoryFilter],
  );
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c])),
    [categories],
  );

  // ─── محصول ──────────────────────────────────────────────────────────────
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [productForm, setProductForm] = useState<ProductFormState>(EMPTY_PRODUCT);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  const editingBotProduct = productForm.id !== null && productForm.categoryId === BOT_CATEGORY_ID;

  function openCreateProduct() {
    setProductForm({ ...EMPTY_PRODUCT, categoryId: categoryFilter !== "all" && categoryFilter !== BOT_CATEGORY_ID ? categoryFilter : "" });
    setProductDialogOpen(true);
  }
  function openEditProduct(p: Product) {
    setProductForm({
      id: p.id, categoryId: p.categoryId, name: p.name, nameFa: p.nameFa,
      description: p.description, descriptionFa: p.descriptionFa,
      price: String(p.price), isActive: p.isActive, icon: p.icon ?? "",
      sortOrder: String(p.sortOrder), metadataText: JSON.stringify(p.metadata ?? {}, null, 2),
    });
    setProductDialogOpen(true);
  }

  async function saveProduct() {
    if (editingBotProduct) {
      // فقط قیمت — همان قفلِ سرور، اینجا هم تکرار می‌شود تا خطای احتمالیِ
      // ۴۰۳ اصلاً پیش نیاید.
      setBusy(true);
      try {
        await customFetch(`/api/admin/products/${productForm.id}`, {
          method: "PATCH",
          body: JSON.stringify({ price: Number(productForm.price) || 0 }),
        });
        invalidate();
        setProductDialogOpen(false);
        toast({ title: fa ? "قیمت به‌روزرسانی شد" : "Price updated" });
      } catch (err: any) {
        toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!productForm.name.trim() || !productForm.categoryId) {
      toast({ variant: "destructive", title: fa ? "نام و دسته الزامی‌اند" : "Name and category are required" });
      return;
    }
    let metadata: Record<string, unknown> = {};
    try {
      metadata = productForm.metadataText.trim() ? JSON.parse(productForm.metadataText) : {};
    } catch {
      toast({ variant: "destructive", title: fa ? "متادیتا JSON معتبر نیست" : "Metadata is not valid JSON" });
      return;
    }
    const body = {
      categoryId: productForm.categoryId,
      name: productForm.name.trim(),
      nameFa: productForm.nameFa.trim(),
      description: productForm.description.trim(),
      descriptionFa: productForm.descriptionFa.trim(),
      price: Number(productForm.price) || 0,
      isActive: productForm.isActive,
      icon: productForm.icon || null,
      sortOrder: Number(productForm.sortOrder) || 0,
      metadata,
    };
    setBusy(true);
    try {
      if (productForm.id) {
        await customFetch(`/api/admin/products/${productForm.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
      }
      invalidate();
      setProductDialogOpen(false);
      toast({ title: productForm.id ? (fa ? "محصول به‌روزرسانی شد" : "Product updated") : (fa ? "محصول ساخته شد" : "Product created") });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteProduct() {
    if (!deletingProduct) return;
    setBusy(true);
    try {
      await customFetch(`/api/admin/products/${deletingProduct.id}`, { method: "DELETE" });
      invalidate();
      setDeletingProduct(null);
      toast({ title: fa ? "محصول حذف شد" : "Product deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  // ─── دسته‌بندی ───────────────────────────────────────────────────────────
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(EMPTY_CATEGORY);
  const [deletingCategory, setDeletingCategory] = useState<ProductCategory | null>(null);

  function openCreateCategory() { setCategoryForm(EMPTY_CATEGORY); setCategoryDialogOpen(true); }
  function openEditCategory(c: ProductCategory) {
    setCategoryForm({
      id: c.id, labelFa: c.labelFa, labelEn: c.labelEn, icon: c.icon ?? "",
      sortOrder: String(c.sortOrder), isActive: c.isActive,
    });
    setCategoryDialogOpen(true);
  }

  async function saveCategory() {
    if (!categoryForm.labelFa.trim() || !categoryForm.labelEn.trim()) {
      toast({ variant: "destructive", title: fa ? "نامِ فارسی و انگلیسی الزامی‌اند" : "labelFa and labelEn are required" });
      return;
    }
    const body = {
      id: categoryForm.id ?? undefined,
      labelFa: categoryForm.labelFa.trim(),
      labelEn: categoryForm.labelEn.trim(),
      icon: categoryForm.icon || null,
      sortOrder: Number(categoryForm.sortOrder) || 0,
      isActive: categoryForm.isActive,
    };
    setBusy(true);
    try {
      if (categoryForm.id) {
        await customFetch(`/api/admin/product-categories/${categoryForm.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await customFetch("/api/admin/product-categories", { method: "POST", body: JSON.stringify(body) });
      }
      invalidate();
      setCategoryDialogOpen(false);
      toast({ title: categoryForm.id ? (fa ? "دسته به‌روزرسانی شد" : "Category updated") : (fa ? "دسته ساخته شد" : "Category created") });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteCategory() {
    if (!deletingCategory) return;
    setBusy(true);
    try {
      await customFetch(`/api/admin/product-categories/${deletingCategory.id}`, { method: "DELETE" });
      invalidate();
      setDeletingCategory(null);
      if (categoryFilter === deletingCategory.id) setCategoryFilter("all");
      toast({ title: fa ? "دسته حذف شد" : "Category deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: fa ? "خطا" : "Error", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* دسته‌بندی‌ها */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold">{fa ? "دسته‌بندیِ محصولات" : "Product categories"}</h3>
          <Button size="sm" variant="outline" onClick={openCreateCategory} className="w-full sm:w-auto">
            <Plus className="me-2 h-4 w-4" /> {fa ? "دسته‌ی جدید" : "New category"}
          </Button>
        </div>
        {categoriesLoading ? (
          <div className="h-12 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "نامِ فارسی" : "Fa label"}</TableHead>
                  <TableHead>{fa ? "نامِ انگلیسی" : "En label"}</TableHead>
                  <TableHead className="hidden md:table-cell">{fa ? "شناسه" : "ID"}</TableHead>
                  <TableHead>{fa ? "فعال" : "Active"}</TableHead>
                  <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(categories ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.labelFa}</TableCell>
                    <TableCell>{c.labelEn}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground" dir="ltr">
                      {c.id}
                      {c.id === BOT_CATEGORY_ID && <Lock className="ms-1.5 inline h-3 w-3 align-text-top text-muted-foreground" />}
                    </TableCell>
                    <TableCell>{c.isActive ? <Badge>{fa ? "بله" : "yes"}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" onClick={() => openEditCategory(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeletingCategory(c)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* محصولات */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold">{fa ? "محصولات" : "Products"}</h3>
          <div className="flex gap-2">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{fa ? "همه‌ی دسته‌ها" : "All categories"}</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{fa ? c.labelFa : c.labelEn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoryFilter === BOT_CATEGORY_ID ? (
              <Button size="sm" disabled title={fa ? "دسته‌ی «بات» ثابت است: فقط Standard/Pro، بدونِ پلنِ سوم." : "The bot category is fixed: Standard/Pro only, no third plan."}>
                <Lock className="me-2 h-4 w-4" /> {fa ? "قفل" : "Locked"}
              </Button>
            ) : (
              <Button size="sm" onClick={openCreateProduct} className="shrink-0"><Plus className="me-2 h-4 w-4" /> {fa ? "محصولِ جدید" : "New product"}</Button>
            )}
          </div>
        </div>
        {categoryFilter === BOT_CATEGORY_ID && (
          <p className="text-xs text-muted-foreground">
            {fa
              ? "دسته‌ی «بات» به Standard/Pro ثابت است (همان دو پکیجی که هنگامِ خریدِ بات شارژ می‌شوند) — فقط قیمتشان قابل‌ویرایش است."
              : "The bot category is fixed to Standard/Pro (the same two packages bot purchases charge) — only their price can be edited."}
          </p>
        )}

        {productsLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fa ? "نام" : "Name"}</TableHead>
                  <TableHead className="hidden md:table-cell">{fa ? "دسته" : "Category"}</TableHead>
                  <TableHead>{fa ? "قیمت" : "Price"}</TableHead>
                  <TableHead>{fa ? "فعال" : "Active"}</TableHead>
                  <TableHead className="text-end">{fa ? "عملیات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{fa ? "محصولی نیست" : "No products"}</TableCell></TableRow>
                )}
                {filteredProducts.map((p) => {
                  const isBot = p.categoryId === BOT_CATEGORY_ID;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {fa ? p.nameFa || p.name : p.name}
                        {isBot && <Lock className="ms-1.5 inline h-3 w-3 align-text-top text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {fa ? categoryById.get(p.categoryId)?.labelFa : categoryById.get(p.categoryId)?.labelEn ?? p.categoryId}
                      </TableCell>
                      <TableCell>{formatToman(p.price, lang)}</TableCell>
                      <TableCell>{p.isActive ? <Badge>{fa ? "بله" : "yes"}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-end">
                        <Button variant="ghost" size="icon" onClick={() => openEditProduct(p)}><Pencil className="h-4 w-4" /></Button>
                        <Button
                          variant="ghost" size="icon" disabled={isBot}
                          title={isBot ? (fa ? "محصولاتِ دسته‌ی بات حذف نمی‌شوند" : "Bot-category products can't be deleted") : undefined}
                          onClick={() => setDeletingProduct(p)}
                        >
                          <Trash2 className={`h-4 w-4 ${isBot ? "text-muted-foreground" : "text-red-500"}`} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* دیالوگِ محصول */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{productForm.id ? (fa ? "ویرایشِ محصول" : "Edit product") : (fa ? "محصولِ جدید" : "New product")}</DialogTitle>
          </DialogHeader>

          {editingBotProduct && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {fa
                ? "این محصول در دسته‌ی «بات» است — فقط قیمت قابل‌ویرایش است."
                : "This product is in the bot category — only price can be edited."}
            </p>
          )}

          <div className="grid gap-3 py-1 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "دسته" : "Category"}</Label>
              <Select
                value={productForm.categoryId}
                onValueChange={(v) => setProductForm({ ...productForm, categoryId: v })}
                disabled={!!productForm.id}
              >
                <SelectTrigger><SelectValue placeholder={fa ? "انتخاب دسته" : "Select category"} /></SelectTrigger>
                <SelectContent>
                  {(categories ?? [])
                    .filter((c) => c.id !== BOT_CATEGORY_ID || editingBotProduct)
                    .map((c) => <SelectItem key={c.id} value={c.id}>{fa ? c.labelFa : c.labelEn}</SelectItem>)}
                </SelectContent>
              </Select>
              {!productForm.id && <p className="text-xs text-muted-foreground">{fa ? "دسته‌ی «بات» اینجا قابل‌انتخاب نیست — پلنِ سوم ساخته نمی‌شود." : "The bot category isn't selectable here — no third plan can be created."}</p>}
            </div>
            <div className="space-y-1.5"><Label>{fa ? "نام (انگلیسی)" : "Name (English)"}</Label><Input dir="ltr" disabled={editingBotProduct} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "نام (فارسی)" : "Name (Farsi)"}</Label><Input disabled={editingBotProduct} value={productForm.nameFa} onChange={(e) => setProductForm({ ...productForm, nameFa: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>{fa ? "قیمت (تومان)" : "Price (Toman)"}</Label>
              <AmountInput value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{fa ? "آیکون" : "Icon"}</Label>
              <Select value={productForm.icon || "__none"} onValueChange={(v) => setProductForm({ ...productForm, icon: v === "__none" ? "" : v })} disabled={editingBotProduct}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{fa ? "بدونِ آیکون" : "No icon"}</SelectItem>
                  {PRODUCT_ICON_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>{fa ? "ترتیبِ نمایش" : "Sort order"}</Label><Input type="number" dir="ltr" disabled={editingBotProduct} value={productForm.sortOrder} onChange={(e) => setProductForm({ ...productForm, sortOrder: e.target.value })} /></div>
            <div className="flex items-end gap-2 pb-1">
              <Switch checked={productForm.isActive} onCheckedChange={(v) => setProductForm({ ...productForm, isActive: v })} id="product-active" disabled={editingBotProduct} />
              <Label htmlFor="product-active">{fa ? "فعال" : "Active"}</Label>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "توضیحات (انگلیسی)" : "Description (English)"}</Label>
              <Textarea dir="ltr" disabled={editingBotProduct} value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} className="min-h-[60px]" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "توضیحات (فارسی)" : "Description (Farsi)"}</Label>
              <Textarea disabled={editingBotProduct} value={productForm.descriptionFa} onChange={(e) => setProductForm({ ...productForm, descriptionFa: e.target.value })} className="min-h-[60px]" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{fa ? "متادیتا (JSON، اختیاری)" : "Metadata (JSON, optional)"}</Label>
              <Textarea
                dir="ltr" disabled={editingBotProduct} value={productForm.metadataText}
                onChange={(e) => setProductForm({ ...productForm, metadataText: e.target.value })}
                className="min-h-[80px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductDialogOpen(false)} disabled={busy}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={saveProduct} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ذخیره" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingProduct} onOpenChange={(o) => !o && setDeletingProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذفِ محصول؟" : "Delete product?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa ? `محصولِ «${deletingProduct?.nameFa || deletingProduct?.name}» حذف می‌شود.` : `“${deletingProduct?.name}” will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteProduct(); }} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* دیالوگِ دسته */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{categoryForm.id ? (fa ? "ویرایشِ دسته" : "Edit category") : (fa ? "دسته‌ی جدید" : "New category")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-1.5"><Label>{fa ? "نامِ فارسی" : "Fa label"}</Label><Input value={categoryForm.labelFa} onChange={(e) => setCategoryForm({ ...categoryForm, labelFa: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>{fa ? "نامِ انگلیسی" : "En label"}</Label><Input dir="ltr" value={categoryForm.labelEn} onChange={(e) => setCategoryForm({ ...categoryForm, labelEn: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>{fa ? "آیکون" : "Icon"}</Label>
              <Select value={categoryForm.icon || "__none"} onValueChange={(v) => setCategoryForm({ ...categoryForm, icon: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{fa ? "بدونِ آیکون" : "No icon"}</SelectItem>
                  {PRODUCT_ICON_NAMES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>{fa ? "ترتیبِ نمایش" : "Sort order"}</Label><Input type="number" dir="ltr" value={categoryForm.sortOrder} onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <Switch checked={categoryForm.isActive} onCheckedChange={(v) => setCategoryForm({ ...categoryForm, isActive: v })} id="category-active" />
              <Label htmlFor="category-active">{fa ? "فعال" : "Active"}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)} disabled={busy}>{fa ? "انصراف" : "Cancel"}</Button>
            <Button onClick={saveCategory} disabled={busy}>{busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "ذخیره" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingCategory} onOpenChange={(o) => !o && setDeletingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{fa ? "حذفِ دسته؟" : "Delete category?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {fa ? `دسته‌ی «${deletingCategory?.labelFa}» حذف می‌شود (اگر محصولِ فعالی داشته باشد، سرور رد می‌کند).` : `“${deletingCategory?.labelEn}” will be deleted (rejected server-side if it still has an active product).`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{fa ? "انصراف" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDeleteCategory(); }} disabled={busy} className="bg-red-600 hover:bg-red-700">
              {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{fa ? "حذف" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
