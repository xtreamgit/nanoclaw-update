#!/usr/bin/env bash
# Publish nanocoai/nanoclaw main as one pull request into this repo.
#
# The sync branch is that upstream commit, not a merge. Merging the pull
# request is what combines the two sides. When they overlap, GitHub blocks
# the merge until a person chooses. This script only asks merge-tree whether
# a combination would be clean, then discards the result. It never writes a
# merge and never pushes to main.
#
# SYNC_SKIP_PR=1 pushes the branch and does not call gh. The workflow leaves
# it unset; scripts/sync-upstream.test.ts sets it.

set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"
SYNC_BRANCH="${SYNC_BRANCH:-sync/upstream-main}"
UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/nanocoai/nanoclaw}"
TITLE='NanoClaw added new commits; review and merge.'

refuse_bad_branch() {
  # A caller-supplied name cannot retarget the one push this script performs.
  if [[ ! "$SYNC_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || [[ "$SYNC_BRANCH" == main ]] || [[ "$SYNC_BRANCH" == refs/heads/main ]]; then
    echo "Refusing to push to ${SYNC_BRANCH}." >&2
    exit 1
  fi
}

# Prints up-to-date, clean, or conflict. Conflict messages go to stderr for
# the job log. The tree merge-tree writes is unused and is not checked out.
status_of() {
  local base="$1"
  local upstream="$2"
  if git merge-base --is-ancestor "$upstream" "$base"; then
    printf '%s\n' up-to-date
    return 0
  fi

  local out status
  out=$(mktemp)
  status=0
  git merge-tree --write-tree --messages "$base" "$upstream" >"$out" || status=$?
  # A dry run is a decision check. The real run keeps the overlap list in the job log.
  if [ "$status" -ne 0 ] && [ "${DRY_RUN:-}" != 1 ]; then
    cat "$out" >&2
  fi
  rm -f "$out"

  if [ "$status" -eq 0 ]; then
    printf '%s\n' clean
  elif [ "$status" -eq 1 ]; then
    printf '%s\n' conflict
  else
    echo "git merge-tree could not compare ${base} and ${upstream} (exit ${status})." >&2
    exit "$status"
  fi
}

write_body() {
  local status="$1"
  local base="$2"
  local upstream="$3"
  local sha count
  sha=$(git rev-parse "$upstream")
  count=$(git rev-list --count "${base}..${upstream}")

  printf '%s\n\n' 'NanoClaw added new commits. Review them and merge.'
  if [ "$status" = conflict ]; then
    printf '%s\n\n' 'Some of these changes overlap with commits already on main. A person has to choose the overlapping changes. This workflow does not choose for you.'
  fi
  printf '%s\n\n' "Upstream main: ${UPSTREAM_URL}/commit/${sha}"
  printf '%s\n' 'New commits:'
  git log -n 30 --format='- %s' "${base}..${upstream}"
  if [ "$count" -gt 30 ]; then
    printf '\n%s\n' "And $((count - 30)) more."
  fi
}

main() {
  refuse_bad_branch
  git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null
  git rev-parse --verify --quiet "${UPSTREAM_REF}^{commit}" >/dev/null

  local status body repo owner existing
  status=$(status_of "$BASE_REF" "$UPSTREAM_REF")

  if [ "$status" = up-to-date ]; then
    echo "${BASE_REF} already contains ${UPSTREAM_REF} ($(git rev-parse --short=12 "$UPSTREAM_REF")). Nothing to do."
    exit 0
  fi

  if [ "$status" != clean ] && [ "$status" != conflict ]; then
    echo "Unexpected sync status: ${status}" >&2
    exit 1
  fi

  body=$(write_body "$status" "$BASE_REF" "$UPSTREAM_REF")

  if [ "${DRY_RUN:-}" = 1 ]; then
    printf 'status=%s\n' "$status"
    printf 'push=%s:refs/heads/%s\n' "$UPSTREAM_REF" "$SYNC_BRANCH"
    printf 'base=main\n'
    printf 'title=%s\n' "$TITLE"
    printf '%s\n' '--- body ---'
    printf '%s\n' "$body"
    exit 0
  fi

  # Fast-forward only. A person may have committed on the sync branch while
  # choosing an overlap; replacing that commit would throw their choice away.
  if ! git push origin "${UPSTREAM_REF}:refs/heads/${SYNC_BRANCH}"; then
    echo "Did not update ${SYNC_BRANCH}. It has commits that are not on upstream, and overwriting them would throw away someone's work. main was not changed, and no overlap was chosen." >&2
    exit 1
  fi

  if [ "${SYNC_SKIP_PR:-}" = 1 ]; then
    echo "Pushed ${UPSTREAM_REF} to ${SYNC_BRANCH}."
    exit 0
  fi

  repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
  owner="${repo%%/*}"
  existing=$(gh pr list --repo "$repo" --base main --head "${owner}:${SYNC_BRANCH}" --state open --json number --jq '.[0].number // empty')

  if [ -n "$existing" ]; then
    gh pr edit --repo "$repo" "$existing" --title "$TITLE" --body "$body"
    echo "Updated pull request #${existing}"
  else
    gh pr create --repo "$repo" --base main --head "$SYNC_BRANCH" --title "$TITLE" --body "$body"
  fi
}

main
