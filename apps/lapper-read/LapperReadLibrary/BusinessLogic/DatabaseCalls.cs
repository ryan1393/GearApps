using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LapperReadLibrary.BusinessLogic;

public sealed class DatabaseCalls : IDatabaseCalls, IDisposable
{
    private readonly ILogger<DatabaseCalls> _logger;
    private readonly HttpClient _client;
    private readonly ApiConfiguration _settings;
    private readonly SemaphoreSlim _authentication = new(1, 1);
    private Auth? _auth;

    public DatabaseCalls(ILogger<DatabaseCalls> logger, IOptions<ApiConfiguration> settings, HttpClient client)
    {
        _logger = logger;
        _settings = settings.Value;
        _client = client;
        _client.BaseAddress = new Uri(_settings.BaseAddress.TrimEnd('/') + "/");
        _client.Timeout = TimeSpan.FromSeconds(_settings.TimeoutSeconds);
    }

    public async Task<Auth?> Login(CancellationToken cancellationToken = default)
    {
        await _authentication.WaitAsync(cancellationToken);
        try { return await LoginCoreAsync(cancellationToken); }
        finally { _authentication.Release(); }
    }

    private async Task<Auth?> LoginCoreAsync(CancellationToken token)
    {
        _auth = null;
        if (string.IsNullOrWhiteSpace(_settings.Email) || string.IsNullOrWhiteSpace(_settings.Password))
            throw new InvalidOperationException("Configure LapperApi:Email and LapperApi:Password before starting the service.");
        using var response = await _client.PostAsJsonAsync("api/v1/auth/login",
            new { email = _settings.Email, password = _settings.Password }, token);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("API login failed with HTTP {StatusCode}", (int)response.StatusCode);
            return null;
        }
        var auth = await response.Content.ReadFromJsonAsync<Auth>(cancellationToken: token);
        if (!string.IsNullOrWhiteSpace(auth?.access_token)) _auth = auth;
        return _auth;
    }

    public async Task<bool> CheckToken(CancellationToken cancellationToken = default) =>
        !string.IsNullOrWhiteSpace(await GetAccessTokenAsync(cancellationToken));

    private async Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        await _authentication.WaitAsync(cancellationToken);
        try
        {
            if (string.IsNullOrWhiteSpace(_auth?.access_token))
                return (await LoginCoreAsync(cancellationToken))?.access_token;
            using var response = await _client.PostAsJsonAsync("api/v1/auth/check-token",
                new { access_token = _auth.access_token }, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var validation = await response.Content.ReadFromJsonAsync<AuthValidate>(cancellationToken: cancellationToken);
                if (validation != null && validation.exp > DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 60)
                    return _auth.access_token;
            }
            return (await LoginCoreAsync(cancellationToken))?.access_token;
        }
        finally { _authentication.Release(); }
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body,
        CancellationToken token, string? requestId = null)
    {
        var usedToken = await GetAccessTokenAsync(token);
        if (string.IsNullOrWhiteSpace(usedToken)) throw new HttpRequestException("API authentication failed.");
        var response = await SendOnceAsync(method, path, body, usedToken, requestId, token);
        if (response.StatusCode != HttpStatusCode.Unauthorized) return response;
        response.Dispose();

        // Do not overwrite a newer token obtained by another in-flight request.
        await _authentication.WaitAsync(token);
        try
        {
            if ((_auth == null || _auth.access_token == usedToken) && await LoginCoreAsync(token) == null)
                throw new HttpRequestException("API authentication refresh failed.");
            usedToken = _auth!.access_token;
        }
        finally { _authentication.Release(); }
        return await SendOnceAsync(method, path, body, usedToken, requestId, token);
    }

    private async Task<HttpResponseMessage> SendOnceAsync(HttpMethod method, string path, object? body,
        string accessToken, string? requestId, CancellationToken token)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (requestId != null) request.Headers.Add("Idempotency-Key", requestId);
        if (body != null) request.Content = JsonContent.Create(body);
        return await _client.SendAsync(request, token);
    }

    private async Task<T?> ReadAsync<T>(HttpMethod method, string path, object? body,
        CancellationToken token, string? requestId = null)
    {
        using var response = await SendAsync(method, path, body, token, requestId);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: token)
            ?? throw new JsonException("API returned an empty response for " + path);
    }

    public Task<Equipment?> GetMachineByIp(string ip, CancellationToken cancellationToken = default, string? machineNumber = null) =>
        ReadAsync<Equipment>(HttpMethod.Get, "api/v1/machine/ip/" + Uri.EscapeDataString(ip) +
            (string.IsNullOrWhiteSpace(machineNumber) ? "" : "?number=" + Uri.EscapeDataString(machineNumber)), null, cancellationToken);

    public Task<ScannerDetail?> GetScannerByIp(string ip, CancellationToken cancellationToken = default) =>
        ReadAsync<ScannerDetail>(HttpMethod.Get, "api/v1/scanner-detail/ip/" + Uri.EscapeDataString(ip), null, cancellationToken);

    public Task<ScannerDetail?> GetScannerById(string id, CancellationToken cancellationToken = default) =>
        ReadAsync<ScannerDetail>(HttpMethod.Get, "api/v1/scanner-detail/" + Uri.EscapeDataString(id), null, cancellationToken);

    public async Task<Gearset?> GetGearsetByNumber(int partNumber, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, "api/v1/gearset/number/" + partNumber, null, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound) return await PostGearset(partNumber, cancellationToken);
        response.EnsureSuccessStatusCode();
        var gearset = await response.Content.ReadFromJsonAsync<Gearset>(cancellationToken: cancellationToken);
        return !string.IsNullOrWhiteSpace(gearset?.id) ? gearset : throw new JsonException("Gearset response has no ID.");
    }

    public Task<Gearset?> PostGearset(int partNumber, CancellationToken cancellationToken = default) =>
        ReadAsync<Gearset>(HttpMethod.Post, "api/v1/gearset", new
        {
            number = partNumber.ToString(CultureInfo.InvariantCulture), status = "active",
            summary_id = (string?)null, pinion_id = (string?)null, ring_id = (string?)null, user_id = (string?)null
        }, cancellationToken);

    public async Task<MachineFanucVariable?> GetMachineFanucVariableByMachineId(Equipment machine, CancellationToken cancellationToken = default)
    {
        using var response = await SendAsync(HttpMethod.Get, "api/v1/machine-fanuc-variable/by-machine/" + Uri.EscapeDataString(machine.id), null, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
            return await PostMachineFanucVariables(false, false, false, machine.id, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<MachineFanucVariable>(cancellationToken: cancellationToken)
            ?? throw new JsonException("Machine-variable response is empty.");
    }

    public Task<MachineFanucVariable?> PatchMachineFanucVariables(bool doorClosed, bool startCycle, bool inCycle,
        MachineFanucVariable variable, CancellationToken cancellationToken = default) =>
        ReadAsync<MachineFanucVariable>(HttpMethod.Patch, "api/v1/machine-fanuc-variable/" + Uri.EscapeDataString(variable.id),
            new { x06_7_frt_dr_closed = doorClosed, x01_2_start_cycle = startCycle, y03_2_stack_inCycle = inCycle }, cancellationToken);

    public Task<MachineFanucVariable?> PostMachineFanucVariables(bool doorClosed, bool startCycle, bool inCycle,
        string machineId, CancellationToken cancellationToken = default) =>
        ReadAsync<MachineFanucVariable>(HttpMethod.Post, "api/v1/machine-fanuc-variable",
            new { machine_id = machineId, x06_7_frt_dr_closed = doorClosed, x01_2_start_cycle = startCycle, y03_2_stack_inCycle = inCycle }, cancellationToken);

    public Task<ScannerDetail?> PutScannerDetailsSerialNumbers(string? process, string? queue, string? scannerSerial,
        ScannerDetail scanner, CancellationToken cancellationToken = default) =>
        ReadAsync<ScannerDetail>(HttpMethod.Patch, "api/v1/scanner-detail/" + Uri.EscapeDataString(scanner.id) + "/serial-numbers",
            new { sn_procces = process, sn_queue = queue, sn_scanner = scannerSerial }, cancellationToken);

    public Task<MachineCycle?> PostMachineCycle(string? serialNumber, int consec, string machineId, string gearsetId,
        DateTimeOffset? timestamp = null, string? requestId = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(serialNumber)) throw new ArgumentException("A scanned serial number is required.", nameof(serialNumber));
        return ReadAsync<MachineCycle>(HttpMethod.Post, "api/v1/machine-cycle",
            new { serial_number = serialNumber, machine_id = machineId, gearset_id = gearsetId, consec, timestamp = timestamp ?? DateTimeOffset.UtcNow },
            cancellationToken, requestId);
    }

    public Task<MacroLog?> PostMacroLog(MachineCycle cycle, string macroId, decimal value,
        string? requestId = null, CancellationToken cancellationToken = default) =>
        ReadAsync<MacroLog>(HttpMethod.Post, "api/v1/macro-log",
            new { machine_cycle_id = cycle.id, macro_id = macroId, value }, cancellationToken, requestId);

    public Task<Macro[]?> GetMacroList(CancellationToken cancellationToken = default) =>
        ReadAsync<Macro[]>(HttpMethod.Get, "api/v1/macro", null, cancellationToken);

    public Task<MacroLog[]?> GetLappingSummary(LastLogData data, CancellationToken cancellationToken = default) =>
        ReadAsync<MacroLog[]>(HttpMethod.Get, "api/v1/macro-log/" + Uri.EscapeDataString(data.machine_id) + "/" + Uri.EscapeDataString(data.gearset_id), null, cancellationToken);

    public void Dispose() { _client.Dispose(); _authentication.Dispose(); }
}
