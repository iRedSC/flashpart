import * as React from "react";
import { Camera, PackagePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAppData } from "../data/app-data-provider";
import { triggerHaptic } from "../lib/haptics";

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
    <div className="flex flex-col gap-6">
      <div className="order-1">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Groups
        </h2>
      </div>

      {/* On mobile, capture comes first; creating groups is secondary. */}
      <div className="order-2 grid gap-4 md:order-3 lg:grid-cols-2">
        {groups.map((group) => {
          const complete =
            group.productCount === 0
              ? 0
              : Math.round((group.completedCount / group.productCount) * 100);

          return (
            <Card key={group._id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{group.name}</CardTitle>
                    <CardDescription>
                      {group.completedCount.toLocaleString()} of{" "}
                      {group.productCount.toLocaleString()} products done
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{group.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-slate-500">Progress</span>
                    <span className="tabular-nums">{complete}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-950 transition-[width] duration-300"
                      style={{ width: `${complete}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 md:flex-row md:items-center">
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
                  <Button
                    className="h-11 rounded-xl md:h-10 md:rounded-md"
                    onClick={() => {
                      triggerHaptic();
                      void assignFirstUngrouped(group._id).catch(() => undefined);
                    }}
                    variant="outline"
                  >
                    Assign ungrouped
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
