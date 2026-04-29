# Coffee Brew Diary

Personal log for dialing in V60 and Espresso. Each session is a commit.

## Structure

```
beans/          — static bean profiles (origin, variety, roast info)
sessions/v60/   — V60 brew sessions (one file per session)
sessions/espresso/ — Espresso sessions
```

## Workflow

```bash
# Log a new session
cp sessions/v60/_template.md sessions/v60/YYYY-MM-DD_bean-name-Xg.md
# fill it in, then:
git add sessions/v60/YYYY-MM-DD_bean-name-Xg.md
git commit -m "[V60] Bean Name Xg — one-line result summary"

# Pin a dialed-in session
git tag dialed/bean-name-v60-Xg

# Start an experiment
git checkout -b experiment/bean-name-what-youre-testing

# Compare two sessions
git diff <commit1> <commit2> -- sessions/v60/

# See full history
git log --oneline
```

## Grinder
1Zpresso Q (clicks from 0)
