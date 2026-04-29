# Coffee Brew Diary

Personal log for dialing in V60 and Espresso. Each brew session is one commit —
`git log` is your diary, `git diff` shows what changed, tags pin the best results.

## Grinder
1Zpresso Q (clicks from 0)

---

## Repo Structure

```
beans/                — one file per coffee: origin, variety, roast info
sessions/
  v60/                — V60 sessions (one file per brew)
  espresso/           — Espresso sessions
  v60/_template.md    — copy this to start a new session
```

---

## How to Add a New Entry

### 1. New bean (first time brewing it)

```bash
cp beans/muraho-women-rwanda.md beans/your-bean-name.md
# fill in: name, origin, processing, variety, altitude, producer, roast_date
git add beans/your-bean-name.md
git commit -m "Add bean: Your Bean Name (Country)"
```

### 2. New brew session

```bash
# Copy the template — filename format: YYYY-MM-DD_bean-name-DOSEg.md
cp sessions/v60/_template.md sessions/v60/2026-05-01_your-bean-9g.md
```

Open the file and fill in the YAML front matter (the block between `---` lines):

```yaml
---
bean: Your Bean Name
origin: Country
processing: Washed / Natural / Honey
roast_date: 2026-04-01
age_days: 30              # days since roast date
method: V60
dose_g: 9
water_g: 135
ratio: "1:15"
grind_clicks: 62          # 1Zpresso Q clicks from 0
temp_c: 93
bloom_g: 27
bloom_s: 30
second_pour_g: 90
second_pour_time: "0:35"
final_pour_g: 135
final_pour_time: "1:10"
brew_time: "2:30"
result: dialed-in         # dialed-in | experiment | fail
---
```

Then write your tasting notes and next steps below the second `---`.

```bash
git add sessions/v60/2026-05-01_your-bean-9g.md
git commit -m "[V60] Your Bean 9g — one-line summary of the cup"
```

**Commit message convention:**
```
[V60] Bean Name Xg — key flavors, grind, result
[Espresso] Bean Name — ratio, outcome
```

### 3. Pin a dialed-in session

Once you've found the sweet spot, tag it so you can always come back:

```bash
git tag dialed/your-bean-v60-9g
```

List all your dialed-in recipes any time:

```bash
git tag
```

### 4. Run an experiment

When you want to test a hypothesis without losing your current baseline:

```bash
# Branch off from wherever you are
git checkout -b experiment/bean-name-what-youre-testing

# example: experiment/el-balar-18g-fruit-recovery

# Brew, fill in a session file, commit it on the branch
git add sessions/v60/2026-05-02_your-bean-18g-v2.md
git commit -m "[V60] Your Bean 18g v2 — coarser grind, lower temp, fruit back?"

# If the experiment succeeds, merge it into main and tag it
git checkout main
git merge experiment/bean-name-what-youre-testing
git tag dialed/your-bean-v60-18g

# If it fails, just leave the branch — it's part of the record
```

---

## How to Read the Data

### See your full brew history

```bash
git log --oneline
```

```
f81143c [V60] El Balar 18g experiment plan — coarser 66-69 clicks, 88-89°C
d118a84 [V60] El Balar 18g — fruit disappears, heavy body, traditional
5c84028 [V60] El Balar 9g — tea-peach, fruity, fermented, 64-66 clicks @ 91°C
f2a8c22 [V60] Muraho Women 9g — balanced, clean, hazelnut/caramel, 60-62 @ 94°C
```

### See all sessions including experiments (visual graph)

```bash
git log --all --oneline --graph --decorate
```

### Read a specific session

```bash
# By filename
cat sessions/v60/2026-04-28_el-balar-9g.md

# Or check out a past commit temporarily
git show f2a8c22:sessions/v60/2026-04-28_muraho-women-9g.md
```

### Compare two sessions side by side

What changed between your 9g and 18g El Balar brews:

```bash
git diff dialed/el-balar-v60-9g d118a84 -- sessions/v60/
```

What changed between any two commits:

```bash
git diff <commit-or-tag-1> <commit-or-tag-2> -- sessions/v60/
```

The YAML front matter makes diffs clean and readable — you'll see exactly which
parameters changed line by line.

### Go back to a specific session's exact parameters

```bash
# See what you brewed on a given date
git log --oneline --after="2026-04-27" --before="2026-04-29"

# Read the file at that commit without leaving your current branch
git show <commit>:sessions/v60/<filename>.md
```

### See all your dialed-in recipes

```bash
git tag
# dialed/el-balar-v60-9g
# dialed/muraho-women-v60-9g

# Read a pinned recipe
git show dialed/muraho-women-v60-9g:sessions/v60/2026-04-28_muraho-women-9g.md
```

### See everything about one bean across all sessions

```bash
git log --oneline --all -- "sessions/v60/*el-balar*"
```

### See open experiments

```bash
git branch | grep experiment
```
