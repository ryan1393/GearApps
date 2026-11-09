using System.Globalization;
using System.Net;
using System.Text.Json;
using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LapperRead.Tests;

public class ApiTests
{
    private static DatabaseCalls Database(HttpDouble http, HttpClient? client = null) => new(NullLogger<DatabaseCalls>.Instance,
        Options.Create(new ApiConfiguration { Email = "test@example.invalid", Password = "configured-for-test" }), client ?? new HttpClient(http));

    [Fact]
    public void ConstructionDoesNotMakeNetworkCalls() { using var http = new HttpDouble(); _ = Database(http); Assert.Empty(http.Calls); }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task StartAndCycleSignalsAreNotSwapped(bool patch)
    {
        using var http = new HttpDouble { Respond = call => call.Path.Contains("machine-fanuc-variable") ? Fixtures.Json(Fixtures.Variables) : null };
        var db = Database(http);
        if (patch) await db.PatchMachineFanucVariables(false, true, false, Fixtures.Variables);
        else await db.PostMachineFanucVariables(false, true, false, "machine");
        using var body = JsonDocument.Parse(http.Calls.Last().Body);
        Assert.True(body.RootElement.GetProperty("x01_2_start_cycle").GetBoolean());
        Assert.False(body.RootElement.GetProperty("y03_2_stack_inCycle").GetBoolean());
    }

    [Fact]
    public async Task ExpiredTokenIsRefreshed()
    {
        using var http = new HttpDouble { Respond = call => call.Path.EndsWith("check-token") ? Fixtures.Json(new { exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 1 }) : null };
        var db = Database(http); await db.Login(); Assert.True(await db.CheckToken()); Assert.Equal(2, http.LoginCount);
    }

    [Fact]
    public async Task FailedRefreshDoesNotReportAuthenticated()
    {
        using var http = new HttpDouble(); var db = Database(http); await db.Login();
        http.Respond = _ => Fixtures.Json(new { }, HttpStatusCode.Unauthorized);
        Assert.False(await db.CheckToken());
    }

    [Fact]
    public async Task UnauthorizedWriteRefreshesAndRetriesWithTheSameKeyAndPayload()
    {
        var writes = 0;
        using var http = new HttpDouble { Respond = call => call.Path.EndsWith("machine-cycle")
            ? Interlocked.Increment(ref writes) == 1 ? Fixtures.Json(new { }, HttpStatusCode.Unauthorized) : Fixtures.Json(Fixtures.Cycle) : null };
        using var client = new HttpClient(http); var db = Database(http, client);
        await db.PostMachineCycle("D123456789", 42, "machine", "gear", DateTimeOffset.UnixEpoch, "stable-key");
        var calls = http.Calls.Where(call => call.Path.EndsWith("machine-cycle")).ToArray();
        Assert.Equal(2, calls.Length); Assert.Equal(calls[0].Body, calls[1].Body);
        Assert.All(calls, call => Assert.Equal("stable-key", call.Key)); Assert.NotEqual(calls[0].Token, calls[1].Token);
        Assert.Null(client.DefaultRequestHeaders.Authorization);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task GearsetReadFailureDoesNotCreateARecord(HttpStatusCode status)
    {
        using var http = new HttpDouble { Respond = call => call.Path.Contains("gearset") ? Fixtures.Json(new { }, status) : null };
        await Assert.ThrowsAsync<HttpRequestException>(() => Database(http).GetGearsetByNumber(123));
        Assert.DoesNotContain(http.Calls, call => call.Method == "POST" && call.Path == "/api/v1/gearset");
    }

    [Fact]
    public async Task OnlyNotFoundCreatesAGearset()
    {
        using var http = new HttpDouble { Respond = call => call.Path.Contains("gearset")
            ? call.Method == "GET" ? Fixtures.Json(new { }, HttpStatusCode.NotFound) : Fixtures.Json(Fixtures.Gear) : null };
        Assert.Equal("gear", (await Database(http).GetGearsetByNumber(123))!.id);
        Assert.Single(http.Calls, call => call.Method == "POST" && call.Path == "/api/v1/gearset");
    }

    [Fact]
    public async Task MacroValueUsesInvariantDecimalFormatting()
    {
        using var http = new HttpDouble { Respond = call => call.Path.EndsWith("macro-log") ? Fixtures.Json(Fixtures.Log("m", 1.25m)) : null };
        var previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("fr-FR"); await Database(http).PostMacroLog(Fixtures.Cycle, "m", 1.25m);
            using var body = JsonDocument.Parse(http.Calls.Last().Body); Assert.Equal(1.25m, body.RootElement.GetProperty("value").GetDecimal());
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public async Task MachineLookupDisambiguatesSharedIpByAssetNumber()
    {
        using var http = new HttpDouble { Respond = call => call.Path.Contains("/machine/ip/") ? Fixtures.Json(Fixtures.Machine) : null };
        await Database(http).GetMachineByIp("127.0.0.1", machineNumber: "01 094&5");
        Assert.EndsWith("?number=01%20094%265", http.Calls.Last().Path);
    }

    [Fact]
    public async Task ScannerTelemetryOnlySendsSerialNumbers()
    {
        using var http = new HttpDouble { Respond = call => call.Path.EndsWith("/serial-numbers") ? Fixtures.Json(Fixtures.Scanner) : null };
        await Database(http).PutScannerDetailsSerialNumbers("process", null, "scanned", Fixtures.Scanner);
        Assert.EndsWith("/scanner-detail/scanner/serial-numbers", http.Calls.Last().Path);
        using var body = JsonDocument.Parse(http.Calls.Last().Body);
        Assert.Equal(3, body.RootElement.EnumerateObject().Count());
        Assert.Equal("process", body.RootElement.GetProperty("sn_procces").GetString());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("sn_queue").ValueKind);
    }

    [Fact]
    public async Task BlankSerialCannotBePosted()
    {
        using var http = new HttpDouble(); await Assert.ThrowsAsync<ArgumentException>(() => Database(http).PostMachineCycle(null, 42, "machine", "gear"));
        Assert.Empty(http.Calls);
    }

    [Fact]
    public async Task ConcurrentRequestsShareAuthenticationWithoutMutatingDefaultHeaders()
    {
        using var http = new HttpDouble
        {
            BeforeResponse = (_, token) => Task.Delay(2, token),
            Respond = call => call.Path.EndsWith("/macro") ? Fixtures.Json(Array.Empty<LapperReadLibrary.Models.Macro>()) : null
        };
        using var client = new HttpClient(http); using var db = Database(http, client);
        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => db.GetMacroList()));
        Assert.Equal(1, http.LoginCount);
        Assert.All(http.Calls.Where(call => call.Path.EndsWith("/macro")), call => Assert.Equal("token-1", call.Token));
        Assert.Null(client.DefaultRequestHeaders.Authorization);
    }

    [Fact]
    public async Task CancellationInterruptsAuthenticationRequests()
    {
        using var http = new HttpDouble { BeforeResponse = (_, token) => Task.Delay(Timeout.Infinite, token) };
        using var db = Database(http); using var stop = new CancellationTokenSource(50);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => db.GetMacroList(stop.Token));
    }
}
