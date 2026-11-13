#!/usr/bin/env python3
"""Portable PowerShell diagnostic tests with fake Docker and the real embedded Node program.

PWSH_BIN=/path/to/pwsh python3 TEST-DIAGNOSE-RXO-EXPEDITE.py
Requires Linux, PowerShell 7 and Node. No Docker operation or RXO request occurs.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
PWSH = os.environ.get('PWSH_BIN') or shutil.which('pwsh')
NODE = shutil.which('node')
SECRET = 'diagnostic-private-secret-do-not-return'
UPPER_SECRET = 'PRIVATE_PASSWORD_VALUE_ABC123'
NOW = datetime.datetime.now(datetime.timezone.utc)
def date(seconds=0):
    return (NOW + datetime.timedelta(seconds=seconds)).isoformat()

@unittest.skipUnless(os.name == 'posix' and PWSH and NODE, 'Requires Linux, PowerShell 7 and Node.')
class DiagnosticTests(unittest.TestCase):
    def fixture(self, running=True, fail='', invalid=False, legacy=False, malformed=False, oversized=False, invalid_codes=False):
        temp = tempfile.TemporaryDirectory(prefix='truck-log-diagnose-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        data, binaries = root/'data', root/'bin'
        data.mkdir(); binaries.mkdir()
        files = {
            'expedite-scheduler-status.json': {'schedulerState':'WAITING','schedulerHeartbeatAt':date(), 'schedulerLoopDeadlineAt':date(120), 'nextRunAt':date(600), 'lastErrorCode':'EXPEDITE_ACQUISITION_FAILED','password':SECRET,'message':SECRET},
            'expedite-health.json': {'version':'1.0.4','state':'FAILED','startedAt':date(-60),'completedAt':date(-30),'errorCode':'EXPEDITE_ACQUISITION_FAILED','diagnostic':{'stage':SECRET if invalid else 'EXPORT_DOWNLOAD','cause':'TIMEOUT','message':SECRET,'stack':SECRET},'password':SECRET},
            'rxo-auth-review.json': {'role':'expedite','phase':'FAILED','code':'RXO_AUTH_APP_NOT_READY','updatedAt':date(-30),'passwordSubmissions':1,'message':SECRET,'credentialVersion':SECRET,'notification':{'detail':SECRET}},
            'rxo-auth-last.json': {'code':'RXO_AUTH_APP_NOT_READY','updatedAt':date(-30),'message':SECRET},
            'rxo-connection-recovery.json': {'phase':'FAILED','requestedAt':date(-120),'updatedAt':date(-90),'attempts':[date(-180),date(-120),date(-90)],'id':SECRET,'credentialVersion':SECRET},
            'rxo-auth-retry.json': {'requestedAt':date(-120),'id':SECRET},
            'rxo_password': SECRET,
        }
        if invalid_codes:
            files['expedite-scheduler-status.json']['lastErrorCode']=UPPER_SECRET
            files['expedite-health.json']['errorCode']=UPPER_SECRET
            files['rxo-auth-review.json']['code']=UPPER_SECRET
            files['rxo-auth-last.json']['code']=UPPER_SECRET
        for name, value in files.items():
            (data/name).write_text(json.dumps(value) if isinstance(value, dict) else value)
        if malformed:(data/'rxo-auth-review.json').write_text('invalid json '+SECRET)
        if oversized:(data/'expedite-health.json').write_text(SECRET*3000)
        before={p.name:(hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mtime_ns) for p in data.iterdir()}
        mock=r'''#!/usr/bin/python3
import json,os,subprocess,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['DIAG_CALLS'],'a') as out:out.write(json.dumps(args)+'\n')
if args[:2]==['context','show']:
 print('existing-diagnostic-context');sys.exit(0)
if args[:1]==['inspect']:
 if '{{.RestartCount}}' in args:print('3');sys.exit(0)
 if os.environ['DIAG_FAIL']=='inspect':print(os.environ['DIAG_SECRET'],file=sys.stderr);sys.exit(44)
 print(json.dumps({'Status':'running' if os.environ['DIAG_RUNNING']=='yes' else 'exited','Running':os.environ['DIAG_RUNNING']=='yes','Restarting':False,'Paused':False,'OOMKilled':True,'ExitCode':137,'StartedAt':os.environ['DIAG_DATE'],'FinishedAt':os.environ['DIAG_DATE'],'Error':os.environ['DIAG_SECRET'],'Health':{'Status':'unhealthy','Log':[{'Output':os.environ['DIAG_SECRET']}]},'Config':{'Env':[os.environ['DIAG_SECRET']]}}));sys.exit(0)
if args[:1]==['exec']:
 assert args==['exec','-i','truck-log-rxo-expedite-scheduler','node','--input-type=module'], args
 program=sys.stdin.read()
 if os.environ['DIAG_FAIL']=='exec':print(os.environ['DIAG_SECRET']);print(os.environ['DIAG_SECRET'],file=sys.stderr);sys.exit(45)
 assert "const root='/app/data/'" in program
 program=program.replace("const root='/app/data/'", 'const root='+json.dumps(os.environ['DIAG_DATA']+'/'))
 if os.environ['DIAG_LEGACY']=='yes':program=program.replace('\r\n','\n').replace('\n','\r\n')
 sys.exit(subprocess.run([os.environ['DIAG_NODE'],'--input-type=module'],input=program,text=True).returncode)
raise AssertionError('Unexpected mutating or unapproved Docker command: '+repr(args))
'''
        docker = binaries/'docker'; docker.write_text(mock); docker.chmod(0o755)
        env = dict(os.environ,PATH=str(binaries)+os.pathsep+os.environ['PATH'],DIAG_CALLS=str(root/'calls.jsonl'),DIAG_FAIL=fail,DIAG_RUNNING='yes' if running else 'no',DIAG_SECRET=SECRET,DIAG_DATE=date(),DIAG_DATA=str(data),DIAG_NODE=NODE,DIAG_LEGACY='yes' if legacy else 'no',TRUCK_LOG_RELEASE='1.0.4')
        script=ROOT/'DIAGNOSE-RXO-EXPEDITE.ps1'
        command=[PWSH,'-NoLogo','-NoProfile','-File',str(script)]
        if legacy:
            driver=root/'legacy.ps1'
            driver.write_text("$PSNativeCommandArgumentPassing='Legacy'\n& '"+str(script).replace("'","''")+"'\nexit $LASTEXITCODE\n")
            command=[PWSH,'-NoLogo','-NoProfile','-File',str(driver)]
        result=subprocess.run(command,env=env,text=True,capture_output=True,timeout=20)
        self.assertNotIn(SECRET,result.stdout+result.stderr)
        self.assertNotIn(UPPER_SECRET,result.stdout+result.stderr)
        after={p.name:(hashlib.sha256(p.read_bytes()).hexdigest(),p.stat().st_mtime_ns) for p in data.iterdir()}
        self.assertEqual(after,before,'Diagnostic changed worker state')
        calls=[json.loads(line) for line in (root/'calls.jsonl').read_text().splitlines()]
        self.assertTrue(all(args[0] in ('context','inspect','exec') for args in calls))
        report=json.loads(result.stdout)
        return result,calls,report
    def test_running_worker_reports_fixed_diagnostic_and_excludes_all_secret_extras(self):
        result,calls,report=self.fixture();self.assertEqual(result.returncode,0)
        self.assertEqual(report['worker']['acquisition']['diagnostic'],{'stage':'EXPORT_DOWNLOAD','cause':'TIMEOUT'})
        self.assertEqual(report['worker']['recovery']['attemptsInLastHour'],3)
        self.assertEqual(report['worker']['recovery']['limit'],3)
        self.assertTrue(report['containerState']['oomKilled']);self.assertEqual(report['containerState']['exitCode'],137)
        self.assertEqual(report['containerState']['restartCount'],3)
        self.assertEqual(report['worker']['workerRelease'],'1.0.4')
        self.assertEqual(report['worker']['scheduler']['state'],'WAITING')
        self.assertTrue(report['worker']['scheduler']['live'])
    def test_unknown_uppercase_error_codes_cannot_cross_the_diagnostic_boundary(self):
        result,calls,report=self.fixture(invalid_codes=True);self.assertEqual(result.returncode,0)
        self.assertIsNone(report['worker']['scheduler']['lastErrorCode']);self.assertIsNone(report['worker']['acquisition']['errorCode']);self.assertIsNone(report['worker']['authentication']['code']);self.assertIsNone(report['worker']['authentication']['lastCode'])
    def test_stopped_worker_is_inspected_without_exec_start_or_recovery(self):
        result,calls,report=self.fixture(running=False);self.assertEqual(result.returncode,0)
        self.assertFalse(any(args[0]=='exec' for args in calls));self.assertIsNone(report['worker']);self.assertIn('not running',report['note'])
    def test_invalid_diagnostic_stage_drops_metadata(self):
        result,calls,report=self.fixture(invalid=True);self.assertEqual(result.returncode,0);self.assertIsNone(report['worker']['acquisition']['diagnostic'])
    def test_malformed_auth_file_reports_unreadable_without_raw_contents(self):
        result,calls,report=self.fixture(malformed=True);self.assertEqual(result.returncode,0);self.assertEqual(report['worker']['authentication']['holdFileStatus'],'UNREADABLE')
    def test_oversized_state_file_is_not_loaded_or_forwarded(self):
        result,calls,report=self.fixture(oversized=True);self.assertEqual(result.returncode,0);self.assertEqual(report['worker']['acquisition']['fileStatus'],'INVALID')
    def test_failed_inspection_exposes_no_raw_native_error(self):
        result,calls,report=self.fixture(fail='inspect');self.assertNotEqual(result.returncode,0);self.assertIn('diagnosticError',report);self.assertFalse(any(args[0]=='exec' for args in calls))
    def test_failed_exec_exposes_no_raw_stdout_or_stderr(self):
        result,calls,report=self.fixture(fail='exec');self.assertEqual(result.returncode,0);self.assertIsNone(report['worker']);self.assertIn('Could not read',report['note'])
    def test_legacy_native_argument_mode_and_crlf_input_run_real_node_program(self):
        result,calls,report=self.fixture(legacy=True);self.assertEqual(result.returncode,0);self.assertEqual(report['worker']['acquisition']['diagnostic']['cause'],'TIMEOUT')

if __name__=='__main__':unittest.main(verbosity=2)
