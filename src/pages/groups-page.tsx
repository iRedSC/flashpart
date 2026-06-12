import * as React from "react";
import { Camera, FolderPlus, MoreVertical, PackagePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { GroupProgressBar } from "../components/group-progress-bar";
import { useAppData } from "../data/app-data-provider";
import { triggerHaptic } from "../lib/haptics";
import { groupProductProgress } from "../lib/group-product-progress";

export function GroupsPage() {
  const { assignFirstUngrouped, createGroup, groups, products } = useAppData();
  const [name, setName] = React.useState("");
  const ungroupedCount = products.filter((product) => !product.groupId).length;

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    try {
      await createGroup(name.trim());
      setName("");
    } catch {
      // The shared data provider reports the error and reverts optimistic state.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain md:overflow-visible">
      <div className="order-1">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Groups
        </h2>
      </div>

      {/* On mobile, capture comes first; creating groups is secondary. */}
      <div className="order-2 grid gap-4 md:order-3 lg:grid-cols-2">
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
            </CardHeader>
          </Card>
        ) : null}
      </div>

      <Card className="order-3 md:order-2">
        <CardHeader>
          <CardTitle>Create a group</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex max-w-xl flex-col gap-2 sm:flex-row"
            onSubmit={handleCreateGroup}
          >
            <Input
              aria-label="Group name"
              className="h-11 md:h-10"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Example: Makita brushes, bin A4"
              value={name}
            />
            <Button className="h-11 rounded-xl md:h-10 md:rounded-md" type="submit">
              <PackagePlus className="h-4 w-4" />
              Create
            </Button>
          </form>
          <p className="mt-3 text-sm text-slate-500">
            {ungroupedCount.toLocaleString()} products are not assigned to a group.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
