import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The route you tried doesn't exist (yet).
        </p>
        <Button asChild className="mt-6 gap-2">
          <Link to="/jobs">
            <ArrowLeft className="size-4" />
            Back to jobs
          </Link>
        </Button>
      </div>
    </div>
  );
}
