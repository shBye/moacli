# Repository ownership transfer

On 2026-09-17, MoaCLI moved from `shBye/moacli` to
[`shb990407-cyber/moacli`](https://github.com/shb990407-cyber/moacli)
using GitHub's repository ownership transfer.

- The destination's pre-existing empty repository was preserved as
  `shb990407-cyber/moacli-empty-before-transfer`.
- The transferred repository retained its original repository ID.
- All advertised Git references matched before and after the transfer.
- Releases v0.1.31 through v0.1.35 retained their release IDs, asset IDs and sizes.
- The local `origin`, package metadata, README, release instructions and app update
  endpoint now point to the new owner.
- Both the old and new latest-installer links returned HTTP 200 with a size of
  95,150,993 bytes for v0.1.35. The old latest-release API also returned HTTP 200.

Existing v0.1.35 installations can continue checking the old API address through
GitHub's redirect. The source update switches future builds to the new address;
existing release installers were not replaced.

Do not recreate a repository at `shBye/moacli`: GitHub documents that reusing the
old location removes the transfer redirects. Keep the empty backup under its
distinct name if retaining it.

Reference: [GitHub repository transfer documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository).
