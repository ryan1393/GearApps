using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LapperRead.Tests;

public class FanucTests
{
    private static Fanuc Controller(DatabaseDouble database, TransportDouble? transport = null) => new(NullLogger<Fanuc>.Instance,
        Options.Create(new LapperConfiguration { MachineIp = "127.0.0.1" }), database, transport ?? new TransportDouble());

    [Fact]
    public async Task CaptureReturnsAnIndependentSnapshot()
    {
        var transport = new TransportDouble(); using var fanuc = Controller(new DatabaseDouble(), transport); await fanuc.InitializeAsync();
        var snapshot = fanuc.CaptureMacros(); transport.Values[10039] = 9;
        Assert.Equal(5, snapshot["m"]); Assert.Equal(9, fanuc.CaptureMacros()["m"]); Assert.Equal(5, snapshot["m"]);
    }

    [Fact]
    public async Task MissingMacroDoesNotPreventOtherChangedOrNewMacroWrites()
    {
        var database = new DatabaseDouble { Summary = [Fixtures.Log("missing", 1), Fixtures.Log("changed", 1)] };
        using var fanuc = Controller(database);
        await fanuc.PersistMacrosAsync(Fixtures.Cycle, new Dictionary<string, decimal> { ["changed"] = 2, ["new"] = 3 }, "request");
        Assert.Contains(("changed", 2m), database.MacroWrites); Assert.Contains(("new", 3m), database.MacroWrites);
        await fanuc.PersistMacrosAsync(Fixtures.Cycle, new Dictionary<string, decimal> { ["missing"] = 1 }, "request2");
        Assert.Equal(2, database.MacroWrites.Count);
    }

    [Fact]
    public async Task FailedMacroWriteIsRetriedBeforeAdvancingTheBaseline()
    {
        var database = new DatabaseDouble { MacroFailures = 1, Summary = [Fixtures.Log("m", 1)] }; using var fanuc = Controller(database);
        var snapshot = new Dictionary<string, decimal> { ["m"] = 2 };
        await Assert.ThrowsAsync<HttpRequestException>(() => fanuc.PersistMacrosAsync(Fixtures.Cycle, snapshot, "same-request"));
        await fanuc.PersistMacrosAsync(Fixtures.Cycle, snapshot, "same-request");
        await fanuc.PersistMacrosAsync(Fixtures.Cycle, snapshot, "next-request");
        Assert.Equal(2, database.MacroAttempts); Assert.Single(database.MacroWrites);
    }

    [Fact]
    public async Task GearsetsHaveIndependentBaselines()
    {
        var database = new DatabaseDouble(); using var fanuc = Controller(database); var values = new Dictionary<string, decimal> { ["m"] = 5 };
        await fanuc.PersistMacrosAsync(Fixtures.Cycle, values, "one");
        await fanuc.PersistMacrosAsync(Fixtures.Cycle with { gearset = Fixtures.Gear with { id = "another" } }, values, "two");
        Assert.Equal(2, database.SummaryCalls); Assert.Equal(2, database.MacroWrites.Count);
    }

    [Fact]
    public void PmcFailureThrowsAndReconnectsRatherThanReportingFalse()
    {
        var transport = new TransportDouble { FailPmc = true }; using var fanuc = Controller(new DatabaseDouble(), transport);
        Assert.Throws<IOException>(() => fanuc.ReadState()); Assert.Equal(1, transport.Closes);
        transport.FailPmc = false; Assert.False(fanuc.ReadState().InCycle); Assert.Equal(2, transport.Opens);
    }

    [Fact]
    public void ZeroCounterFailsOnceWithoutAnInternalRetryLoop()
    {
        var transport = new TransportDouble(); transport.Values[10032] = 0; using var fanuc = Controller(new DatabaseDouble(), transport);
        Assert.Throws<IOException>(() => fanuc.ReadState()); Assert.Equal(1, transport.Opens);
    }

    [Fact]
    public void ScaledIntegerMacrosRemainValidCounters()
    {
        var transport = new TransportDouble(); transport.Values[10020] = 123.00m; transport.Values[10032] = 42.0m;
        using var fanuc = Controller(new DatabaseDouble(), transport);
        Assert.Equal(123, fanuc.ReadState().Ident); Assert.Equal(42, fanuc.ReadState().Consec);
    }
}
