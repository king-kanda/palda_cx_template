"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronRight, ExternalLink, LayoutGrid, Store, Users, Wrench, type LucideIcon } from "lucide-react";
import type { CustomerStatus } from "@garden/services";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/shadcn/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/shadcn/sidebar";
import { LogoMark } from "@/components/ui";
import { AgentAvatar } from "../../components/avatar-picker";
import { CustomerStatusPill } from "../../components/status-pill";

type Leaf = { label: string; path: string };
type Item =
  | { key: string; label: string; icon: LucideIcon; path: string; items?: undefined }
  | { key: string; label: string; icon: LucideIcon; items: Leaf[]; path?: undefined };

const NAV: Item[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid, path: "" },
  {
    key: "agent",
    label: "Agent",
    icon: Bot,
    items: [
      { label: "Profile & voice", path: "/agent" },
      { label: "Tools", path: "/agent/tools" },
      { label: "Knowledge", path: "/agent/knowledge" },
      { label: "Memory", path: "/agent/memory" },
      { label: "Integrations", path: "/agent/integrations" },
      { label: "Runs", path: "/runs" },
    ],
  },
  {
    key: "business",
    label: "Business",
    icon: Store,
    items: [
      { label: "Details & hours", path: "/business" },
      { label: "Branding", path: "/business/branding" },
      { label: "Documents", path: "/business/documents" },
      { label: "Team & services", path: "/team" },
    ],
  },
  { key: "access", label: "Access", icon: Users, path: "/access" },
  {
    key: "ops",
    label: "Operations",
    icon: Wrench,
    items: [
      { label: "Rollout", path: "/rollout" },
      { label: "Connections", path: "/connections" },
    ],
  },
];

// palda-homes active state: lime-400 with brand-900 text (UI-SPEC 3.1); hover is the muted surface.
const ITEM = "h-11 rounded-xl px-3 text-[0.9375rem] font-medium data-[active=true]:bg-lime-400 data-[active=true]:text-brand-900 [&>svg]:size-5";
const SUB = "h-9 rounded-lg text-sm data-[active=true]:bg-lime-100 data-[active=true]:font-medium data-[active=true]:text-brand-900";

export function WorkspaceSidebar({
  id,
  name,
  status,
  summary,
  agentName,
  agentAvatar,
  openApp,
}: {
  id: string;
  name: string;
  status: CustomerStatus;
  summary: string;
  agentName: string;
  agentAvatar: string | null;
  openApp: (formData: FormData) => void | Promise<void>;
}) {
  const pathname = usePathname();
  const { state, setOpen, setOpenMobile } = useSidebar();
  const base = `/engine/${id}`;
  const matches = (path: string) =>
    path === "" ? pathname === base : pathname === base + path || pathname.startsWith(`${base + path}/`);
  // The most specific match wins, so "Tools" (/agent/tools) is current there and "Profile & voice" (/agent) is not.
  const best = NAV.flatMap((i) => (i.items ? i.items.map((l) => l.path) : [i.path ?? ""]))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isCurrent = (path: string) => path === best;
  const collapsed = state === "collapsed";

  return (
    // palda-homes shell: the sidebar runs full height with the brand at its top; the header sits over the content column.
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-0 p-0">
        <Link
          href="/engine"
          className="flex h-18 shrink-0 items-center gap-2 border-b border-sidebar-border px-5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <LogoMark className="size-7 shrink-0 text-brand-800" />
          <span className="text-lg font-bold tracking-tight group-data-[collapsible=icon]:hidden">palda cx</span>
          <span className="rounded-md bg-lime-400 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-brand-900 group-data-[collapsible=icon]:hidden">
            engine
          </span>
        </Link>
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <AgentAvatar src={agentAvatar} name={agentName} className="size-10" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="font-mono text-[0.6562rem] uppercase tracking-[0.1em] text-ink-muted">Workspace</p>
            <div className="flex items-center gap-2">
              <p className="truncate text-base font-semibold">{name}</p>
              <CustomerStatusPill status={status} />
            </div>
            <p className="truncate text-xs text-ink-muted">{summary}</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-4 py-3 group-data-[collapsible=icon]:px-3">
          <SidebarMenu className="gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              if (!item.items) {
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={isCurrent(item.path)} tooltip={item.label} className={ITEM}>
                      <Link href={base + item.path} onClick={() => setOpenMobile(false)}>
                        <Icon strokeWidth={1.75} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }
              const active = item.items.some((leaf) => isCurrent(leaf.path));
              return (
                // A group is a dropdown: it opens inline and starts open when one of its pages is current.
                <Collapsible key={item.key} defaultOpen={active} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={active}
                        className={ITEM}
                        // From the icon rail, opening a group first expands the sidebar so its pages are visible.
                        onClick={() => collapsed && setOpen(true)}
                      >
                        <Icon strokeWidth={1.75} />
                        <span>{item.label}</span>
                        <ChevronRight className="ml-auto !size-4 text-ink-muted transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub className="ml-[1.4rem] gap-1 border-l border-sidebar-border py-1 pl-3 pr-0">
                        {item.items.map((leaf) => (
                          <SidebarMenuSubItem key={leaf.path}>
                            <SidebarMenuSubButton asChild isActive={isCurrent(leaf.path)} className={SUB}>
                              <Link href={base + leaf.path} onClick={() => setOpenMobile(false)}>
                                <span>{leaf.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:px-3">
        <form action={openApp}>
          <input type="hidden" name="tenantId" value={id} />
          <SidebarMenuButton
            type="submit"
            tooltip="Open their app"
            className="h-11 justify-center rounded-xl border border-sidebar-border text-sm font-medium"
          >
            <span className="group-data-[collapsible=icon]:hidden">Open their app</span>
            <ExternalLink />
          </SidebarMenuButton>
        </form>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
