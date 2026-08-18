# Notes
Each git worktree is a separate directory withits own `node_modules`, and both hooks silently skip themselves when `node_modules` is missing. So the fix is simply that in Phase2, worktree setup is 2 commands, not one

```
git worktree add .worktrees/targets -b feat/dynamic-targets
cd .worktrees/targets && npm ci
```


restaurantName field needs to be resolved in the NormalizedReview object.

flip `targets.example.json` to array shape