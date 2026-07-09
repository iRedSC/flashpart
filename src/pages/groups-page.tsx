import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Camera,
  Check,
  FolderPlus,
  MoreVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { CreateGroupDialog } from "../components/create-group-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { GroupProgressBar } from "../components/group-progress-bar";
import { useAppData } from "../data/app-data-provider";
import { triggerHaptic } from "../lib/haptics";
import {
  groupProductProgress,
  isGroupArchived,
} from "../lib/product-state";

const VIEW_ACTIVE = "active";
const VIEW_ARCHIVED = "archived";
type GroupsView = typeof VIEW_ACTIVE | typeof VIEW_ARCHIVED;

export function GroupsPage() {
  const {
    archiveGroup,
    assignFirstUngrouped,
    deleteGroup,
    groups,
    products,
    unarchiveGroup,
  } = useAppData();
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const viewFilter: GroupsView =
    searchParams.get("view") === VIEW_ARCHIVED ? VIEW_ARCHIVED : VIEW_ACTIVE;
  const ungroupedCount = products.filter(
    (product) => !product.groupId && product.archivedAt === undefined,
  ).length;
  const visibleGroups = groups.filter((group) =>
    viewFilter === VIEW_ARCHIVED
      ? isGroupArchived(group)
      : !isGroupArchived(group),
  );
  const viewFilterLabel =
    viewFilter === VIEW_ARCHIVED ? "Archived" : "Active";

  function setViewFilter(value: GroupsView) {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);

        if (value === VIEW_ARCHIVED) {
          next.set("view", VIEW_ARCHIVED);
        } else {
          next.delete("view");
        }

        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] md:overflow-visible">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Groups
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="max-w-40 px-3 text-slate-950 md:px-4"
                variant="outline"
              >
                <Archive className="h-4 w-4" />
                <span className="truncate">{viewFilterLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setViewFilter(VIEW_ACTIVE)}>
                <span className="flex-1">Active</span>
                {viewFilter === VIEW_ACTIVE ? <Check /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setViewFilter(VIEW_ARCHIVED)}>
                <span className="flex-1">Archived</span>
                {viewFilter === VIEW_ARCHIVED ? <Check /> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          className="h-11 shrink-0 rounded-xl md:h-10 md:rounded-md"
          onClick={() => setCreateGroupOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New group
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {visibleGroups.map((group) => {
          const progress = groupProductProgress(
            products.filter((product) => product.groupId === group._id),
          );
          const archived = isGroupArchived(group);
          const activeCount =
            progress.pending + progress.captured + progress.published;

          return (
            <Card
              className="relative transition-colors hover:border-slate-300"
              key={group._id}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      {/* Stretched link: the whole card opens the filtered
                          products page; buttons below sit above it. */}
                      <Link
                        className="after:absolute after:inset-0 after:rounded-xl"
                        to={`/products?group=${group._id}${
                          archived && activeCount === 0 && progress.archived > 0
                            ? "&view=archived"
                            : ""
                        }`}
                      >
                        {group.name}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {progress.total.toLocaleString()} products
                      {progress.archived > 0
                        ? ` · ${progress.archived.toLocaleString()} archived`
                        : null}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`Actions for ${group.name}`}
                        className="relative z-10 h-9 w-9 shrink-0 p-0"
                        variant="ghost"
                      >
                        <MoreVertical className="h-[18px] w-[18px]" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={ungroupedCount === 0 || archived}
                        onSelect={() => {
                          triggerHaptic();
                          void assignFirstUngrouped(group._id).catch(
                            () => undefined,
                          );
                        }}
                      >
                        <FolderPlus />
                        Assign ungrouped
                      </DropdownMenuItem>
                      {archived ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            triggerHaptic();
                            void unarchiveGroup(group._id).catch(
                              () => undefined,
                            );
                          }}
                        >
                          <ArchiveRestore />
                          Unarchive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => {
                            triggerHaptic();
                            void archiveGroup(group._id).catch(
                              () => undefined,
                            );
                          }}
                        >
                          <Archive />
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-red-600 focus:bg-red-50 focus:text-red-600"
                        onSelect={() => {
                          triggerHaptic();
                          void deleteGroup(group._id).catch(() => undefined);
                        }}
                      >
                        <Trash2 />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <GroupProgressBar progress={progress} />

                <div className="relative flex flex-col gap-2 md:flex-row md:items-center">
                  {archived || activeCount === 0 ? (
                    <Button
                      className="h-12 flex-1 rounded-xl text-base md:h-10 md:flex-none md:rounded-md md:text-sm"
                      disabled
                    >
                      <Camera className="h-5 w-5 md:h-4 md:w-4" />
                      Capture
                    </Button>
                  ) : (
                    <Button
                      asChild
                      className="h-12 flex-1 rounded-xl text-base md:h-10 md:flex-none md:rounded-md md:text-sm"
                    >
                      <Link
                        onClick={() => triggerHaptic()}
                        to={`/capture/${group._id}`}
                      >
                        <Camera className="h-5 w-5 md:h-4 md:w-4" />
                        Capture
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {visibleGroups.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {viewFilter === VIEW_ARCHIVED
                  ? "No archived groups"
                  : "No groups yet"}
              </CardTitle>
              <CardDescription>
                {viewFilter === VIEW_ARCHIVED
                  ? "Archived groups will show up here."
                  : "Create a group to start capturing and organizing products."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      <CreateGroupDialog
        onOpenChange={setCreateGroupOpen}
        open={createGroupOpen}
        ungroupedCount={ungroupedCount}
      />
    </div>
  );
}
