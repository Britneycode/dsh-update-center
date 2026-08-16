$ErrorActionPreference = 'Stop'

$guard = 'D:\App\dsh\Update-JobGuard.ps1'
if (-not (Test-Path -LiteralPath $guard)) {
    throw "missing guard script: $guard"
}

. $guard

$running = [pscustomobject]@{ status = 'running'; workerPid = $PID }
$completed = [pscustomobject]@{ status = 'completed'; workerPid = $PID }
$workerCommand = 'node C:\Users\13372\.dsh\update-center\dsh-update-worker.mjs C:\Users\13372\.dsh\update-center\jobs\1.spec.json'

if (-not (Test-DSHUpdateJobActive -Job $running)) {
    throw 'running update job was not recognized as active'
}
if (Test-DSHUpdateJobActive -Job $completed) {
    throw 'completed update job was incorrectly recognized as active'
}
if (-not (Test-DSHUpdateWorkerCommand -CommandLine $workerCommand)) {
    throw 'update worker command line was not recognized'
}
if (Test-DSHUpdateWorkerCommand -CommandLine 'node apps\cli\src\bin.ts web') {
    throw 'ordinary dsh process was incorrectly recognized as update worker'
}

Write-Output 'launcher job guard tests passed'
