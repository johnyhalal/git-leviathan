import type { CommitPerson } from '../../../../types/ipc';

/**
 * Everyone a commit credits: its author, then `Co-authored-by:` co-authors, then
 * the committer when a different person. Shared by the graph's Author column,
 * the commit detail panel, file history and blame so they list people alike.
 */
export interface Credits {
  author: CommitPerson;
  coAuthors?: CommitPerson[];
  committer?: CommitPerson | null;
}

/** The credits carried on a log entry or blame line. */
export const entryCredits = (entry: {
  author: string;
  authorEmail: string;
  authorAvatarUrl: string;
  coAuthors?: CommitPerson[];
  committer?: CommitPerson;
}): Credits => ({
  author: { name: entry.author, email: entry.authorEmail, avatarUrl: entry.authorAvatarUrl },
  coAuthors: entry.coAuthors,
  committer: entry.committer,
});

/** Every credited person in display order (author first). */
export function creditedPeople({ author, coAuthors = [], committer }: Credits): CommitPerson[] {
  return committer ? [author, ...coAuthors, committer] : [author, ...coAuthors];
}

/** Whether anyone beyond the author is credited. */
export const hasExtraCredits = (credits: Credits) => creditedPeople(credits).length > 1;

/** The credited names, comma-joined: "Author, Co-author, Committer". */
export const creditNames = (credits: Credits) =>
  creditedPeople(credits)
    .map((person) => person.name)
    .join(', ');

/** One line per credited person with their role, for a multi-line tooltip. */
export function creditLines({ author, coAuthors = [], committer }: Credits): string {
  const lines = [`Author: ${author.name}`, ...coAuthors.map((person) => `Co-author: ${person.name}`)];
  if (committer) lines.push(`Committer: ${committer.name}`);
  return lines.join('\n');
}

/**
 * The credited people's avatars, overlapping GitHub-style with the author in
 * front and everyone else tucked behind (z-index descends along the row). Each
 * avatar gets its own tooltip; `authorTooltip` overrides the author's, e.g. for
 * blame's richer commit summary. `className` styles every avatar (size, shape).
 */
export function AvatarStack({
  credits,
  className,
  size,
  authorTooltip,
  stackClassName = '',
}: {
  credits: Credits;
  className: string;
  size: number;
  authorTooltip?: string;
  stackClassName?: string;
}) {
  const { author, coAuthors = [], committer } = credits;
  const avatars = [
    {
      key: 'author',
      person: author,
      tooltip: authorTooltip ?? `${author.name} <${author.email}>`,
    },
    ...coAuthors.map((person) => ({
      key: `co:${person.email}`,
      person,
      tooltip: `Co-author: ${person.name} <${person.email}>`,
    })),
    ...(committer
      ? [
          {
            key: 'committer',
            person: committer,
            tooltip: `Committer: ${committer.name} <${committer.email}>`,
          },
        ]
      : []),
  ];
  return (
    <span className={`avatar-stack ${stackClassName}`.trim()}>
      {avatars.map((avatar, index) => (
        <img
          key={avatar.key}
          className={className}
          src={avatar.person.avatarUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          // Earlier avatars sit on top, so the author stays in front.
          style={{ zIndex: avatars.length - index }}
          data-tooltip={avatar.tooltip}
        />
      ))}
    </span>
  );
}
