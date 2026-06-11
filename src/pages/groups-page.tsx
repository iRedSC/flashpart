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
import type { Id } from "../../convex/_generated/dataModel";

export function GroupsPage() {
  const { assignFirstUngrouped, createGroup, groups, products } = useAppData();
  const [name, setName] = React.useState("");
  const [assignCounts, setAssignCounts] = React.useState<Record<string, string>>({});
  const ungroupedCount = products.filter((product) => !product.groupId).length;

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    await createGroup(name.trim());
    setName("");
  }

  function countForGroup(groupId: Id<"groups">) {
    return Number.parseInt(assignCounts[groupId] ?? "10", 10);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">Groups</h2>
        <p className="text-slate-500">
          Create photo work batches and assign imported products to them.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a group</CardTitle>
          <CardDescription>
            Groups are the photo segments used by the mobile capture flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex max-w-xl gap-2" onSubmit={handleCreateGroup}>
            <Input
              aria-label="Group name"
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Example: Makita brushes, bin A4"
              value={name}
            />
            <Button type="submit">
              <PackagePlus className="h-4 w-4" />
              Create
            </Button>
          </form>
          <p className="mt-3 text-sm text-slate-500">
            {ungroupedCount.toLocaleString()} products are not assigned to a group.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const assignCount = countForGroup(group._id);
          const complete =
            group.productCount === 0
              ? 0
              : Math.round((group.completedCount / group.productCount) * 100);

          return (
            <Card key={group._id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{group.name}</CardTitle>
                    <CardDescription>
                      {group.productCount.toLocaleString()} products,
                      {" "}
                      {group.completedCount.toLocaleString()} completed
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">{group.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-slate-500">Progress</span>
                    <span>{complete}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-950"
                      style={{ width: `${complete}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Assign count for ${group.name}`}
                    className="w-28"
                    min={1}
                    onChange={(event) =>
                      setAssignCounts((current) => ({
                        ...current,
                        [group._id]: event.currentTarget.value,
                      }))
                    }
                    type="number"
                    value={assignCounts[group._id] ?? "10"}
                  />
                  <Button
                    onClick={() =>
                      void assignFirstUngrouped(
                        group._id,
                        Number.isFinite(assignCount) ? assignCount : 0,
                      )
                    }
                    variant="outline"
                  >
                    Assign ungrouped
                  </Button>
                  <Button asChild>
                    <Link to={`/capture/${group._id}`}>
                      <Camera className="h-4 w-4" />
                      Capture
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No groups yet</CardTitle>
            <CardDescription>
              Create a group, assign rows, then open capture on your phone.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
