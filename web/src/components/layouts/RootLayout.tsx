import { Outlet } from 'react-router-dom';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { JobsProvider } from '@/lib/jobsContext';
import { AppSidebar } from './AppSidebar';
import { Breadcrumbs } from './Breadcrumbs';

// Authenticated app shell. Sets up:
//   - JobsProvider: single polled jobs list, shared by sidebar badge +
//     JobsPage so we don't fan out to multiple intervals.
//   - SidebarProvider: persists open/collapsed state in cookie (default
//     shadcn behaviour) and wires Cmd+B keyboard shortcut.
//   - Inset variant: sidebar floats; main pane is a rounded card.
export function RootLayout() {
  return (
    <JobsProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumbs />
          </header>
          <div className="flex-1 min-h-0 overflow-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </JobsProvider>
  );
}
