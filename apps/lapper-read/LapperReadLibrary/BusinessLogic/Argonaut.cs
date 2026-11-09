using LapperReadLibrary.BusinessLogic.Interfaces;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using LapperReadLibrary.Models;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System;
using System.Text.Json;

namespace LapperReadLibrary.BusinessLogic;

public class Argonaut : IArgonaut, IDisposable
{
    private readonly ILogger<Argonaut> _logger;
    private readonly IFanuc _fanuc;
    private readonly ArgonautConfiguration _settings;
    private readonly HttpClient _client;

    public Argonaut(ILogger<Argonaut> logger, IFanuc fanuc, IOptions<ArgonautConfiguration> settings, HttpClient client)
    {
        _logger = logger;
        _fanuc = fanuc;
        _settings = settings.Value;
        _client = client;
    }

    public async Task ArgoPostMacroLog(string serialNumber, string partNumber, int consec, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(_settings.Endpoint, UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrWhiteSpace(_settings.Username) || string.IsNullOrWhiteSpace(_settings.Password))
            throw new InvalidOperationException("Configure the Argonaut HTTPS endpoint and credentials before enabling its integration.");
        try
        {
            int[] dintData = [];

            decimal[] floatData = [
                0,
                ReadDecimal(10039),
                ReadDecimal(10040),
                ReadDecimal(10042),
                ReadDecimal(10043),
                ReadDecimal(10045),
                ReadDecimal(10046),
                ReadDecimal(10047),
                ReadDecimal(10049),
                ReadDecimal(10050),
                ReadDecimal(10051),
                ReadDecimal(10053),
                ReadDecimal(10054),
                ReadDecimal(10055),
                ReadDecimal(10063),
                ReadDecimal(10209),
                ReadDecimal(10401),
                ReadDecimal(10402),
                ReadDecimal(10403),
                ReadDecimal(10404),
                ReadDecimal(10405),
                ReadDecimal(10406),
                ReadDecimal(10407),
                ReadDecimal(10408),
                ReadDecimal(10409),
                ReadDecimal(10410),
                ReadDecimal(10412),
                ReadDecimal(10413),
                ReadDecimal(10414),
                ReadDecimal(10415),
                ReadDecimal(10416),
                ReadDecimal(10418),
                ReadDecimal(10419),
                ReadDecimal(10421),
                ReadDecimal(10426),
                ReadDecimal(10428),
                ReadDecimal(10430),
                ReadDecimal(10433),
                ReadDecimal(10435),
                ReadDecimal(10437),
                ReadDecimal(10481),
                ReadDecimal(10482),
                ReadDecimal(10483),
                ReadDecimal(10484),
                ReadDecimal(10485),
                ReadDecimal(10486),
                ReadDecimal(10487),
                ReadDecimal(10488),
                ReadDecimal(10489),
                ReadDecimal(10490),
                ReadDecimal(10492),
                ReadDecimal(10493),
                ReadDecimal(10494),
                ReadDecimal(10495),
                ReadDecimal(10496),
                ReadDecimal(10498),
                ReadDecimal(10499),
                ReadDecimal(10501),
                ReadDecimal(10506),
                ReadDecimal(10508),
                ReadDecimal(10510),
                ReadDecimal(10513),
                ReadDecimal(10515),
                ReadDecimal(10517),
        ];

            string[] stringData = [
                decimal.ToInt32(ReadDecimal(10020)).ToString(CultureInfo.InvariantCulture),
                decimal.ToInt32(ReadDecimal(10021)).ToString(CultureInfo.InvariantCulture),
                decimal.ToInt32(ReadDecimal(10023)).ToString(CultureInfo.InvariantCulture),
                decimal.ToInt32(ReadDecimal(10400)).ToString(CultureInfo.InvariantCulture),
                decimal.ToInt32(ReadDecimal(10480)).ToString(CultureInfo.InvariantCulture),
        ];

            var data = new
            {
                sequence = consec,                        //# Required increment up can repeat after 100 or 1000
                transactionTypeId = 100,                  //# Required it is the Transaction Type in Track and Trace
                serialNumber = serialNumber,              //# Required
                dintData = dintData,                      //# Required
                floatData = floatData,                    //# Required
                stringData = stringData,                  //# Required
                partNumber = partNumber,                  //# Required
                partNumberCode = 0                        //# Required
            };

            var apiRequest = new
            {
                request = data
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes(_settings.Username + ":" + _settings.Password)));
            request.Content = new StringContent(JsonSerializer.Serialize(apiRequest), Encoding.UTF8, "application/json");
            using var response = await _client.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
        }
        catch (HttpRequestException e)
        {
            _logger.LogError(e, "Argonaut cycle submission failed");
            throw;
        }
    }

    private decimal ReadDecimal(short number) =>
        decimal.TryParse(_fanuc.GetMacroValue(number), NumberStyles.Number, CultureInfo.InvariantCulture, out var value)
            ? value : throw new IOException($"Argonaut macro {number} is unavailable.");

    public void Dispose() => _client.Dispose();
}
