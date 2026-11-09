using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;

namespace LapperRead.Tests;

internal static class Fixtures
{
    public static Equipment Machine = new("machine", "1", "127.0.0.1", null, null, null, null, null, "active", null);
    public static Gearset Gear = new("gear", "123", null, "summary", null, null, "active", null);
    public static MachineCycle Cycle = new("cycle", Machine, Gear, 42, "2026-11-09T12:00:00Z");
    public static ScannerDetail Scanner = new("scanner", "model", "type", "description", "", "", "", "127.0.0.1", "active", Machine, Machine.id);
    public static MachineFanucVariable Variables = new("variables", false, false, false, Machine, Machine.id);
    public static Macro Macro(string id, short number = 10039) => new(id, number, id, 1, "", null, "", "", "");
    public static MacroLog Log(string id, decimal value) => new("log", Cycle, Cycle.id, Macro(id), id, value);
    public static HttpResponseMessage Json(object value, HttpStatusCode code = HttpStatusCode.OK) => new(code) { Content = JsonContent.Create(value) };
}

internal sealed class TestArea : IDisposable
{
    public string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "LapperRead.Tests", Guid.NewGuid().ToString("N"));
    public string StatePath => Path.Combine(DirectoryPath, "state.json");
    public TestArea() => Directory.CreateDirectory(DirectoryPath);
    public void Dispose()
    {
        if (!Path.GetFullPath(DirectoryPath).StartsWith(Path.Combine(Path.GetTempPath(), "LapperRead.Tests") + Path.DirectorySeparatorChar))
            throw new InvalidOperationException("Unexpected test cleanup path.");
        Directory.Delete(DirectoryPath, recursive: true);
    }
}

internal sealed class HttpDouble : HttpMessageHandler
{
    public record Call(string Method, string Path, string Body, string? Token, string? Key);
    public ConcurrentQueue<Call> Calls = new();
    public Func<Call, HttpResponseMessage?>? Respond;
    public Func<Call, CancellationToken, Task>? BeforeResponse;
    public int LoginCount;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        var call = new Call(request.Method.Method, request.RequestUri!.AbsolutePath,
            request.Content == null ? "" : await request.Content.ReadAsStringAsync(token),
            request.Headers.Authorization?.Parameter,
            request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null);
        Calls.Enqueue(call);
        if (BeforeResponse != null) await BeforeResponse(call, token);
        if (Respond?.Invoke(call) is { } response) return response;
        if (call.Path.EndsWith("/login")) return Fixtures.Json(new Auth("token-" + Interlocked.Increment(ref LoginCount)));
        if (call.Path.EndsWith("/check-token")) return Fixtures.Json(new { exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 3600 });
        return Fixtures.Json(new { });
    }
}

internal sealed class DatabaseDouble : IDatabaseCalls
{
    public record CycleWrite(string? Serial, int Consec, string Machine, string Gearset, DateTimeOffset? Timestamp, string? Key);
    public ConcurrentQueue<CycleWrite> Cycles = new();
    public ConcurrentQueue<(string Id, decimal Value)> MacroWrites = new();
    public ConcurrentQueue<(string? Process, string? Queue, string? Scanner)> ScannerWrites = new();
    public int CycleAttempts, MacroAttempts, SummaryCalls;
    public int CycleFailures, MacroFailures;
    public Macro[] Macros = [Fixtures.Macro("m")];
    public MacroLog[] Summary = [];
    public Task<Auth?> Login(CancellationToken cancellationToken = default) => Task.FromResult<Auth?>(new("test"));
    public Task<bool> CheckToken(CancellationToken cancellationToken = default) => Task.FromResult(true);
    public Task<Equipment?> GetMachineByIp(string ip, CancellationToken cancellationToken = default) => Task.FromResult<Equipment?>(Fixtures.Machine);
    public Task<ScannerDetail?> GetScannerByIp(string ip, CancellationToken cancellationToken = default) => Task.FromResult<ScannerDetail?>(Fixtures.Scanner);
    public Task<ScannerDetail?> GetScannerById(string id, CancellationToken cancellationToken = default) => Task.FromResult<ScannerDetail?>(Fixtures.Scanner);
    public Task<Gearset?> GetGearsetByNumber(int partNumber, CancellationToken cancellationToken = default) => Task.FromResult<Gearset?>(Fixtures.Gear with { number = partNumber.ToString() });
    public Task<Gearset?> PostGearset(int partNumber, CancellationToken cancellationToken = default) => GetGearsetByNumber(partNumber, cancellationToken);
    public Task<MachineFanucVariable?> GetMachineFanucVariableByMachineId(Equipment machine, CancellationToken cancellationToken = default) => Task.FromResult<MachineFanucVariable?>(Fixtures.Variables);
    public Task<MachineFanucVariable?> PatchMachineFanucVariables(bool doorClosed, bool startCycle, bool inCycle, MachineFanucVariable variable, CancellationToken cancellationToken = default) => Task.FromResult<MachineFanucVariable?>(variable);
    public Task<ScannerDetail?> PutScannerDetailsSerialNumbers(string? process, string? queue, string? scannerSerial, ScannerDetail scanner, CancellationToken cancellationToken = default)
    { ScannerWrites.Enqueue((process, queue, scannerSerial)); return Task.FromResult<ScannerDetail?>(scanner); }
    public Task<MachineCycle?> PostMachineCycle(string? serialNumber, int consec, string machineId, string gearsetId, DateTimeOffset? timestamp = null, string? requestId = null, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref CycleAttempts);
        if (Interlocked.Decrement(ref CycleFailures) >= 0) throw new HttpRequestException("Simulated outage");
        Cycles.Enqueue(new(serialNumber, consec, machineId, gearsetId, timestamp, requestId));
        return Task.FromResult<MachineCycle?>(Fixtures.Cycle);
    }
    public Task<MacroLog?> PostMacroLog(MachineCycle cycle, string macroId, decimal value, string? requestId = null, CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref MacroAttempts);
        if (Interlocked.Decrement(ref MacroFailures) >= 0) throw new HttpRequestException("Simulated outage");
        MacroWrites.Enqueue((macroId, value)); return Task.FromResult<MacroLog?>(Fixtures.Log(macroId, value));
    }
    public Task<Macro[]?> GetMacroList(CancellationToken cancellationToken = default) => Task.FromResult<Macro[]?>(Macros);
    public Task<MacroLog[]?> GetLappingSummary(LastLogData data, CancellationToken cancellationToken = default)
    { Interlocked.Increment(ref SummaryCalls); return Task.FromResult<MacroLog[]?>(Summary); }
}

internal sealed class TransportDouble : IFanucTransport
{
    public int Opens, Closes;
    public bool FailPmc;
    public Dictionary<short, decimal?> Values = new() { [10020] = 123, [10032] = 42, [10039] = 5 };
    public ushort Open(string ip, int timeoutSeconds) { Opens++; return 0; }
    public void Close(ushort handle) => Closes++;
    public decimal? ReadMacro(ushort handle, short number) => Values.GetValueOrDefault(number);
    public bool ReadPmc(ushort handle, short addressType, short dataType, ushort start, ushort end, int bit) => FailPmc ? throw new IOException("PMC unavailable") : false;
}
