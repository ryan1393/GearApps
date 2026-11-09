using System.Net;
using System.Text;
using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LapperRead.Tests;

public class ArgonautTests
{
    private sealed class Macros : IFanuc
    {
        public string? Value = "1.25";
        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public MachineState ReadState() => throw new NotSupportedException();
        public string? GetMacroValue(short number) => Value;
        public Dictionary<string, decimal> CaptureMacros() => new();
        public Task PersistMacrosAsync(MachineCycle cycle, IReadOnlyDictionary<string, decimal> values, string requestId, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public void Dispose() { }
    }

    [Fact]
    public async Task ConfiguredCredentialsAreUsedAndHttpFailureIsNotSwallowed()
    {
        using var http = new HttpDouble { Respond = _ => Fixtures.Json(new { }, HttpStatusCode.InternalServerError) };
        var service = new Argonaut(NullLogger<Argonaut>.Instance, new Macros(), Options.Create(new ArgonautConfiguration
        { Endpoint = "https://mes.example.invalid/transaction", Username = "configured-user", Password = "configured-secret" }), new HttpClient(http));
        await Assert.ThrowsAsync<HttpRequestException>(() => service.ArgoPostMacroLog("D123456789", "123", 42));
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes("configured-user:configured-secret")), Assert.Single(http.Calls).Token);
    }

    [Fact]
    public async Task PlainHttpEndpointIsRejectedBeforeReadingOrSending()
    {
        using var http = new HttpDouble();
        var service = new Argonaut(NullLogger<Argonaut>.Instance, new Macros(), Options.Create(new ArgonautConfiguration
        { Endpoint = "http://mes.example.invalid/transaction", Username = "configured-user", Password = "configured-secret" }), new HttpClient(http));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ArgoPostMacroLog("D123456789", "123", 42)); Assert.Empty(http.Calls);
    }

    [Fact]
    public async Task MissingMacroIsNotSubmittedAsZero()
    {
        using var http = new HttpDouble();
        var service = new Argonaut(NullLogger<Argonaut>.Instance, new Macros { Value = null }, Options.Create(new ArgonautConfiguration
        { Endpoint = "https://mes.example.invalid/transaction", Username = "configured-user", Password = "configured-secret" }), new HttpClient(http));
        await Assert.ThrowsAsync<IOException>(() => service.ArgoPostMacroLog("D123456789", "123", 42)); Assert.Empty(http.Calls);
    }
}
