# FANUC FOCAS library (not committed)

Put FANUC's licensed **Linux** FOCAS library here before starting the collector:

    apps/lapper-read-py/fanuc/libfwlib32.so

Use the 64-bit x86 build (`libfwlib32-linux-x64.so.*`) from your FOCAS2 package and
rename or symlink it to `libfwlib32.so`. Docker Compose mounts this folder read-only
at `/opt/fanuc` (override with `LAPPER_READ_FOCAS_DIR`).

The library is licensed by FANUC, so it is ignored by git and never baked into the image.

## Remote deploys

`commands/Deploy-MeshForge.cmd` (`tools/manufacturing/deploy/deploy-remote.mjs`) replaces the
whole release folder on the Docker host. Because this library is not in git or a GitHub ZIP,
the deploy carries `libfwlib32*` (the library and any symlink to it) over from the release it
replaces (the current one, or the last good one when retrying a failed deploy), the same way it
keeps the host's `.env`. A library shipped in the package being deployed is used instead. A
rollback to an older release without the library keeps the current one. The carried files are
made readable by the collector's unprivileged container user.

If the collector has a container and no library is found anywhere, the deploy prints a
`[WARN] No FANUC FOCAS library ...` line but still finishes: the collector starts, yet records
no cycles until the library is in place.

**Recommended on a server:** keep the library outside the release folder, so no deploy or
rollback ever touches it. For example:

    sudo mkdir -p /opt/meshforge/fanuc
    sudo cp libfwlib32-linux-x64.so.1.0.5 /opt/meshforge/fanuc/
    sudo ln -s libfwlib32-linux-x64.so.1.0.5 /opt/meshforge/fanuc/libfwlib32.so
    sudo chmod 755 /opt/meshforge/fanuc && sudo chmod 644 /opt/meshforge/fanuc/libfwlib32-linux-x64.so.1.0.5

and set `LAPPER_READ_FOCAS_DIR=/opt/meshforge/fanuc` (an absolute path) in the host's `.env`.
The deploy leaves an absolute folder alone; a relative one is read from inside the release.
