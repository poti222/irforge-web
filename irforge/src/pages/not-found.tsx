import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";
import { useT } from "@/hooks/use-translation";

export default function NotFound() {
  const t = useT("common");
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold">{t.notFoundTitle}</h1>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            {t.notFoundDesc}
          </p>

          <Button asChild className="mt-6">
            <Link href="/">
              <Home className="me-2 h-4 w-4" /> {t.backToHome}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
