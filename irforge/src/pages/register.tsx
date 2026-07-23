import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { GlowButton } from "@/components/ui/glow-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Shake } from "@/components/ui/shake";
import { useSEO } from "@/hooks/use-seo";
import { LoginMascot } from "@/components/auth/LoginMascot";
import { Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { OrangeRobot } from "@/components/layout/brand-home";
import { useT } from "@/hooks/use-translation";

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  useSEO({ title: "ثبت‌نام | IrForge", noindex: true });
  const { register } = useAuth();
  const { toast } = useToast();
  const tr = useT("auth");
  const [isLoading, setIsLoading] = useState(false);
  const [errorShake, setErrorShake] = useState(0); // W6: shake form on error

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
    },
  });

  // W7: mascot reactivity — focus state + live field lengths + the V1 reveal toggle.
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [passwordShown, setPasswordShown] = useState(false);
  const emailValue = form.watch("email");
  const passwordValue = form.watch("password");

  async function onSubmit(data: RegisterFormValues) {
    setIsLoading(true);
    try {
      await register(data);
      toast({
        title: tr.accountCreatedTitle,
        description: tr.accountCreatedDesc,
      });
    } catch (error: any) {
      setErrorShake((c) => c + 1);
      toast({
        variant: "destructive",
        title: tr.registrationFailedTitle,
        description: error?.message || tr.registrationFailedDefaultDesc,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-background relative">
      <Link
        href="/"
        className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        data-testid="link-back-home"
      >
        <ArrowLeft className="size-4 rtl-flip" />
        {tr.backToHome}
      </Link>

      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <Link href="/" className="flex items-center gap-2 mb-8 hover:opacity-80 transition-opacity">
          <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <OrangeRobot className="size-6" />
          </div>
          <span className="font-bold text-2xl tracking-tight">IrForge</span>
        </Link>
        <h2 className="text-center text-2xl font-bold tracking-tight text-foreground">
          {tr.createAccountTitle}
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {tr.alreadyHaveAccount}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {tr.signInLink}
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[400px]">
        <LoginMascot
          className="mx-auto mb-4 size-20"
          emailLength={emailValue?.length ?? 0}
          emailFocused={emailFocused}
          passwordFocused={passwordFocused}
          passwordLength={passwordValue?.length ?? 0}
          showPassword={passwordShown}
        />
        <Shake trigger={errorShake} className="bg-card px-4 py-8 shadow-xl sm:rounded-xl border sm:px-10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit, () => setErrorShake((c) => c + 1))} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr.fullName}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tr.fullNamePlaceholder}
                        {...field}
                        data-testid="input-register-name"
                        disabled={isLoading}
                        className="bg-background"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr.emailAddress}</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="developer@example.com"
                        {...field}
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => { field.onBlur(); setEmailFocused(false); }}
                        data-testid="input-register-email"
                        disabled={isLoading}
                        className="bg-background"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tr.password}</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="••••••••"
                        {...field}
                        onFocusedChange={setPasswordFocused}
                        show={passwordShown}
                        onShowChange={setPasswordShown}
                        data-testid="input-register-password"
                        disabled={isLoading}
                        className="bg-background"
                      />
                    </FormControl>
                    <p className="text-[10px] text-muted-foreground mt-1">{tr.passwordMinHint}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <GlowButton
                type="submit"
                className="w-full h-11"
                wrapperClassName="w-full"
                disabled={isLoading}
                data-testid="button-register-submit"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {tr.creatingAccount}
                  </>
                ) : (
                  tr.registerButton
                )}
              </GlowButton>
            </form>
          </Form>
        </Shake>
      </div>
    </div>
  );
}
