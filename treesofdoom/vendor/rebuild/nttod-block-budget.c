/* GPL-2.0: conservative ARM instruction budgets at translation-block boundaries.
 * ARM instructions occupy four bytes; Thumb instructions occupy at least two.
 * Charging by byte size and ISA therefore overestimates, never underestimates,
 * executed instructions (including conditional exits). The cap32 backend
 * limits blocks to 32 instructions. No guest instruction bytes are modified.
 */
#include <stdint.h>
#include <unicorn/unicorn.h>
#include <unicorn/arm.h>

typedef struct {
    uc_engine *uc;
    uc_hook hook;
    uint32_t budget;
    uint32_t used;
    int active;
} budget_state;
static budget_state states[16];

static void count_block(uc_engine *uc, uint64_t address, uint32_t size, void *data)
{
    budget_state *state = data;
    (void)address;
    if (!state->active) return;
    uint32_t cpsr = 0;
    uc_reg_read(uc, UC_ARM_REG_CPSR, &cpsr);
    uint32_t width = (cpsr & 32) ? 2 : 4;
    uint32_t charge = size ? (size + width - 1) / width : 1;
    // Finish at most one block beyond the requested boundary. This also makes
    // progress when a caller requests a batch smaller than a translation block.
    if (state->used >= state->budget) {
        uc_emu_stop(uc);
        return;
    }
    state->used += charge;
}

static budget_state *lookup(uc_engine *uc)
{
    for (unsigned i = 0; i < 16; ++i)
        if (states[i].uc == uc) return &states[i];
    return 0;
}

uc_err nttod_emu_start_budget(uc_engine *uc, uint32_t begin, uint32_t until, uint32_t budget)
{
    budget_state *state = lookup(uc);
    if (!state) {
        for (unsigned i = 0; i < 16; ++i) {
            if (!states[i].uc) { state = &states[i]; break; }
        }
        if (!state) return UC_ERR_RESOURCE;
        state->uc = uc;
        uc_err error = uc_hook_add(uc, &state->hook, UC_HOOK_BLOCK,
                                  (void *)count_block, state, 1, 0);
        if (error) { state->uc = 0; return error; }
    }
    state->used = 0;
    state->budget = budget;
    state->active = 1;
    uc_err error = uc_emu_start(uc, begin, until, 0, 0);
    state->active = 0;
    return error;
}

uint32_t nttod_budget_used(uc_engine *uc)
{
    budget_state *state = lookup(uc);
    return state ? state->used : 0;
}

void nttod_clear_budget(uc_engine *uc)
{
    budget_state *state = lookup(uc);
    if (state) { uc_hook_del(uc, state->hook); state->uc = 0; }
}
