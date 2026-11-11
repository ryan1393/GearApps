using System.Net;
using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Serilog;
using Serilog.Events;

namespace LapperRead;

public static class Program
{
    public static int Main(string[] args)
    {
        Log.Logger = new LoggerConfiguration().WriteTo.Console().CreateLogger();
        try
        {
            using var host = CreateHostBuilder(args).Build();
            Log.Information("Starting Lapper Read");
            host.Run();
            return 0;
        }
        catch (Exception exception)
        {
            Log.Fatal(exception, "Lapper Read could not start");
            return 1;
        }
        finally { Log.CloseAndFlush(); }
    }

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .UseWindowsService()
            .ConfigureServices((context, services) =>
            {
                services.AddOptions<LapperConfiguration>()
                    .Bind(context.Configuration.GetSection("LapperConfiguration"))
                    .PostConfigure(settings => ApplyMachineOverride(settings, args))
                    .Validate(settings => IPAddress.TryParse(settings.MachineIp, out _) && IPAddress.TryParse(settings.ScannerIp, out _),
                        "Configure valid machine and scanner IP addresses.")
                    .Validate(settings => settings.PollIntervalMilliseconds > 0 && settings.RetryDelayMilliseconds > 0 &&
                        settings.IoTimeoutMilliseconds > 0 && settings.ScannerInput1Port is > 0 and <= 65535 &&
                        settings.ScannerInput2Port is > 0 and <= 65535 && !string.IsNullOrWhiteSpace(settings.StateDirectory),
                        "Polling intervals, ports and state directory must be valid.")
                    .ValidateOnStart();
                services.AddOptions<ApiConfiguration>()
                    .Bind(context.Configuration.GetSection("MeshForgeApi"))
                    .Validate(settings => Uri.TryCreate(settings.BaseAddress, UriKind.Absolute, out var uri) &&
                        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && settings.TimeoutSeconds > 0,
                        "Configure a valid Lapper API address and timeout.")
                    .Validate(settings => !string.IsNullOrWhiteSpace(settings.Email) && !string.IsNullOrWhiteSpace(settings.Password),
                        "Set MeshForgeApi__Email and MeshForgeApi__Password in the service environment or configuration.")
                    .ValidateOnStart();
                services.Configure<ArgonautConfiguration>(context.Configuration.GetSection("Argonaut"));
                services.AddHttpClient("MeshForgeApi");
                services.AddHttpClient("Argonaut", client => client.Timeout = TimeSpan.FromSeconds(10));
                services.AddSingleton<IDatabaseCalls>(provider => new DatabaseCalls(
                    provider.GetRequiredService<Microsoft.Extensions.Logging.ILogger<DatabaseCalls>>(),
                    provider.GetRequiredService<IOptions<ApiConfiguration>>(),
                    provider.GetRequiredService<IHttpClientFactory>().CreateClient("MeshForgeApi")));
                services.AddSingleton<IArgonaut>(provider => new Argonaut(
                    provider.GetRequiredService<Microsoft.Extensions.Logging.ILogger<Argonaut>>(),
                    provider.GetRequiredService<IFanuc>(),
                    provider.GetRequiredService<IOptions<ArgonautConfiguration>>(),
                    provider.GetRequiredService<IHttpClientFactory>().CreateClient("Argonaut")));
                services.AddSingleton<IFanucTransport, FocasTransport>();
                services.AddSingleton<IFanuc, Fanuc>();
                services.AddSingleton<IScanners, Scanner>();
                services.AddSingleton(provider =>
                {
                    var settings = provider.GetRequiredService<IOptions<LapperConfiguration>>().Value;
                    var directory = Path.GetFullPath(settings.StateDirectory, AppContext.BaseDirectory);
                    return new CycleStateStore(Path.Combine(directory, settings.MachineIp.Replace(':', '_') + ".json"));
                });
                services.AddHostedService<Worker>();
            })
            .UseSerilog((context, services, logger) =>
            {
                var settings = services.GetRequiredService<IOptions<LapperConfiguration>>().Value;
                var directory = Path.GetFullPath(settings.StateDirectory, AppContext.BaseDirectory);
                logger.MinimumLevel.Information().MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                    .Enrich.FromLogContext().WriteTo.Console()
                    .WriteTo.File(Path.Combine(directory, "logs", settings.MachineIp.Replace(':', '_') + "-.log"),
                        rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14);
            });

    public static void ApplyMachineOverride(LapperConfiguration settings, string[] args)
    {
        var argument = args.FirstOrDefault(value => value.StartsWith("ip=", StringComparison.OrdinalIgnoreCase));
        if (argument != null) settings.MachineIp = argument[3..];
    }
}
