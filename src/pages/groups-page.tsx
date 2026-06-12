import * as React from "react";
import { Camera, FolderPlus, MoreVertical, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
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
import { groupProductProgress } from "../lib/product-state";

export function GroupsPage() {
  const { assignFirstUngrouped, deleteGroup, groups, products } = useAppData();
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false);
  const ungroupedCount = products.filter((product) => !product.groupId).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain md:overflow-visible">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Groups
        </h2>
        <Button
          className="h-11 shrink-0 rounded-xl md:h-10 md:rounded-md"
          onClick={() => setCreateGroupOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New group
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const progress = groupProductProgress(
            products.filter((product) => product.groupId === group._id),
          );

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
                        to={`/products?group=${group._id}`}
                      >
                        {group.name}
                      </Link>
                    </CardTitle>
                    <CardDescription>
                      {progress.total.toLocaleString()} products
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
                        disabled={ungroupedCount === 0}
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
                </div>
              </CardContent>
            </Card>
          );
        })}

        {groups.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No groups yet</CardTitle>
              <CardDescription>
                Create a group to start capturing and organizing products.
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
