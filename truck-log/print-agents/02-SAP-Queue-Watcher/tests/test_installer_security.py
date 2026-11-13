"""Windows ACL integration tests: harmless temporary files, no services or printers."""
import ctypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent.parent
IS_WINDOWS_ADMIN = os.name == 'nt' and bool(ctypes.windll.shell32.IsUserAnAdmin())


@unittest.skipUnless(IS_WINDOWS_ADMIN and shutil.which('powershell.exe'),
                     'Requires Windows administrator and Windows PowerShell for real NTFS ACL validation')
class InstallerCredentialAclTests(unittest.TestCase):
    def run_acl_upgrade(self, outside_state=False, interrupted=False):
        source = (HERE / 'INSTALL-WATCHER-SERVICE.ps1').read_text()
        helper = source[source.index('function Set-WatcherAcl('):source.index("\nWrite-Host 'Truck Log SAP")]
        operation = source[source.index('# 9. Protect an existing credential'):source.index('# 10. Credential:')]
        # Exercise the actual installer helper/operation. Observe each Set-Acl and
        # fail if the credential is ever broadened, including an interrupted run.
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'check.ps1'
            destination = str(Path(folder) / 'state').replace("'", "''")
            secret = str(Path(folder) / ('external.credential' if outside_state else 'state/upload.credential')).replace("'", "''")
            script.write_text("""$ErrorActionPreference = 'Stop'
$stateDir = 'STATE_PATH'
$paths = @{ credentialFile = 'CREDENTIAL_PATH' }
[void](New-Item -ItemType Directory -Path $stateDir -Force)
Set-Content -LiteralPath $paths.credentialFile -Value 'nonsecret fixture'
$script:changes = New-Object 'Collections.Generic.List[string]'
function Assert-PrivateCredential {
  $acl = Get-Acl -LiteralPath $paths.credentialFile
  if (-not $acl.AreAccessRulesProtected) { throw 'Credential inheritance exposed' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 2) { throw ('Unexpected credential rules: ' + $rules.Count) }
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544') -or
        $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') {
      throw 'Credential access broadened'
    }
  }
}
function Set-Acl {
  param([string]$LiteralPath, $AclObject, $ErrorAction)
  Microsoft.PowerShell.Security\\Set-Acl -LiteralPath $LiteralPath -AclObject $AclObject -ErrorAction Stop
  $script:changes.Add($LiteralPath)
  Assert-PrivateCredential
  if (__INTERRUPT__ -and $LiteralPath -eq $stateDir) { throw 'SIMULATED INTERRUPTION' }
}
HELPER
try {
OPERATION
} catch {
  if (-not (__INTERRUPT__ -and $_.Exception.Message -eq 'SIMULATED INTERRUPTION')) { throw }
}
Assert-PrivateCredential
if ($script:changes.Count -ne 2 -or $script:changes[0] -ne $paths.credentialFile) { throw 'Unsafe ACL operation order' }
$stateAcl = Get-Acl -LiteralPath $stateDir
$stateSids = @($stateAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })
if (@($stateSids | Where-Object { $_ -notin @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-32-545') }).Count) { throw 'Unexpected state access' }
if ('S-1-5-32-545' -notin $stateSids) { throw 'Nonsecret state is not readable' }
Write-Output 'ACL PASS'
""".replace('STATE_PATH', destination).replace('CREDENTIAL_PATH', secret)
                .replace('HELPER', helper).replace('OPERATION', operation)
                .replace('__INTERRUPT__', '$true' if interrupted else '$false'), encoding='ascii')
            run = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                 capture_output=True, text=True, timeout=30)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertIn('ACL PASS', run.stdout)

    def test_upgrade_keeps_credential_private_inside_or_outside_state(self):
        for outside in (False, True):
            with self.subTest(outside_state=outside):
                self.run_acl_upgrade(outside_state=outside)

    def test_interrupted_upgrade_leaves_credential_private(self):
        self.run_acl_upgrade(interrupted=True)


if __name__ == '__main__':
    unittest.main()
