namespace LapperReadLibrary.Models;

public record MachineFanucVariable(
    string id,
    bool x06_7_frt_dr_closed,
    bool y03_2_stack_inCycle,
    bool x01_2_start_cycle,
    Equipment machine,
    string machine_id
);