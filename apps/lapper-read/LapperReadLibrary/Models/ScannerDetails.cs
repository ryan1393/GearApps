namespace LapperReadLibrary.Models;

public record ScannerDetail(
    string id,
    string model,
    string type,
    string description,
    string sn_procces,
    string sn_queue,
    string sn_scanner,
    string ip,
    string status,
    Equipment machine,
    string machine_id
);