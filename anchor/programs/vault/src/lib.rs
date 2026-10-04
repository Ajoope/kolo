use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[cfg(test)]
mod tests;

declare_id!("BVNGa6bQ7xPoiXd3Gz1JANVBVugbXD1Q5WQaAYAZ2y5c");

pub const MAX_MEMBERS: usize = 16;
pub const DEFAULT_GRACE_PERIOD: i64 = 216_000; // 60 hours in seconds
pub const DEFAULT_LATE_FEE_BPS: u16 = 700; // 7% in basis points (1 bp = 0.01%)

#[program]
pub mod vault {
    use super::*;

    /// Initialize a new rotating savings circle (Kolo / Ajo)
    pub fn create_circle(
        ctx: Context<CreateCircle>,
        circle_id: u64,
        contribution_amount: u64,
        frequency: i64,
        max_members: u8,
        payout_order: Vec<Pubkey>,
    ) -> Result<()> {
        require!(max_members >= 2 && max_members as usize <= MAX_MEMBERS, KoloError::InvalidMemberCount);
        require!(contribution_amount > 0, KoloError::InvalidContributionAmount);
        require!(frequency > 0, KoloError::InvalidFrequency);
        require!(payout_order.len() <= max_members as usize, KoloError::InvalidPayoutOrder);

        let circle = &mut ctx.accounts.circle;
        circle.creator = ctx.accounts.creator.key();
        circle.circle_id = circle_id;
        circle.contribution_amount = contribution_amount;
        circle.frequency = frequency;
        circle.grace_period_duration = DEFAULT_GRACE_PERIOD;
        circle.late_fee_bps = DEFAULT_LATE_FEE_BPS;
        circle.max_members = max_members;
        circle.member_count = 0;
        circle.current_round = 0;
        circle.status = CircleStatus::Forming;
        circle.current_round_start = 0;
        circle.usdc_mint = ctx.accounts.usdc_mint.key();
        circle.bump = ctx.bumps.circle;
        circle.vault_bump = ctx.bumps.vault;
        circle.payout_order = payout_order;
        circle.current_round_collected = 0;
        circle.current_round_forfeited_pool = 0;
        circle.current_round_contributor_count = 0;
        circle.defaulted_count = 0;

        Ok(())
    }

    /// Member joins the circle by locking 1x contribution_amount collateral stake into the vault.
    /// When all seats are filled, circle status moves to Active and round 0 starts.
    pub fn join_circle(ctx: Context<JoinCircle>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        require!(circle.status == CircleStatus::Forming, KoloError::CircleNotForming);
        require!(circle.member_count < circle.max_members, KoloError::CircleFull);

        // Transfer collateral stake (1x contribution_amount) into circle vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.member_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.member_wallet.to_account_info(),
                },
            ),
            circle.contribution_amount,
        )?;

        let member = &mut ctx.accounts.member;
        member.wallet = ctx.accounts.member_wallet.key();
        member.circle = circle.key();
        member.stake_amount = circle.contribution_amount;
        member.is_staked = true;
        member.contributions_paid = 0;
        member.last_contributed_round = 255; // Sentinel: has not contributed yet
        member.has_defaulted = false;
        member.has_received_payout = false;
        member.grace_period_started_at = 0;
        member.stake_refunded = false;
        member.bump = ctx.bumps.member;

        // If not already in fixed payout order, add member wallet
        if !circle.payout_order.contains(&member.wallet) {
            circle.payout_order.push(member.wallet);
        }

        circle.member_count += 1;

        // Once all seats are filled, activate circle and start round 0
        if circle.member_count == circle.max_members {
            let clock = Clock::get()?;
            circle.status = CircleStatus::Active;
            circle.current_round_start = clock.unix_timestamp;
        }

        Ok(())
    }

    /// Member pays their regular round contribution (or late payment with fee) into the vault.
    pub fn contribute(ctx: Context<Contribute>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        require!(circle.status == CircleStatus::Active, KoloError::CircleNotActive);
        require!(!member.has_defaulted, KoloError::MemberDefaulted);
        require!(member.last_contributed_round != circle.current_round, KoloError::AlreadyContributedThisRound);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let regular_deadline = circle.current_round_start.checked_add(circle.frequency).ok_or(KoloError::MathOverflow)?;

        let mut amount_to_pay = circle.contribution_amount;

        if now <= regular_deadline {
            // On-time payment: standard contribution
            member.grace_period_started_at = 0;
        } else {
            // Late payment: check if within grace period
            let grace_deadline = if member.grace_period_started_at > 0 {
                member.grace_period_started_at.checked_add(circle.grace_period_duration).ok_or(KoloError::MathOverflow)?
            } else {
                regular_deadline.checked_add(circle.grace_period_duration).ok_or(KoloError::MathOverflow)?
            };

            require!(now <= grace_deadline, KoloError::GracePeriodExpired);

            // Calculate late fee (e.g., 7% of contribution amount)
            let late_fee = (circle.contribution_amount as u128)
                .checked_mul(circle.late_fee_bps as u128)
                .ok_or(KoloError::MathOverflow)?
                .checked_div(10_000)
                .ok_or(KoloError::MathOverflow)? as u64;

            amount_to_pay = circle.contribution_amount.checked_add(late_fee).ok_or(KoloError::MathOverflow)?;
            member.grace_period_started_at = 0;
        }

        // Transfer USDC contribution into the vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.member_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.member_wallet.to_account_info(),
                },
            ),
            amount_to_pay,
        )?;

        circle.current_round_collected = circle.current_round_collected.checked_add(amount_to_pay).ok_or(KoloError::MathOverflow)?;
        circle.current_round_contributor_count = circle.current_round_contributor_count.checked_add(1).ok_or(KoloError::MathOverflow)?;
        member.contributions_paid += 1;
        member.last_contributed_round = circle.current_round;

        Ok(())
    }

    /// Starts a grace period (e.g. 60 hours) with a late fee if the round deadline passed without contribution.
    pub fn handle_late_payment(ctx: Context<HandleLatePayment>) -> Result<()> {
        let circle = &ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        require!(circle.status == CircleStatus::Active, KoloError::CircleNotActive);
        require!(!member.has_defaulted, KoloError::MemberDefaulted);
        require!(member.last_contributed_round != circle.current_round, KoloError::AlreadyContributedThisRound);

        // caller_member is derived from the caller's pubkey and constrained to
        // this circle, which already enforces that the caller is a member.
        let _ = &ctx.accounts.caller_member;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let deadline = circle.current_round_start.checked_add(circle.frequency).ok_or(KoloError::MathOverflow)?;

        require!(now > deadline, KoloError::RoundDeadlineNotPassed);
        require!(member.grace_period_started_at == 0, KoloError::GracePeriodAlreadyStarted);

        member.grace_period_started_at = now;

        Ok(())
    }

    /// Forfeits a member's locked collateral stake into the current round's pot if unpaid past the grace period.
    ///
    /// NOTE ON PROCESS_DEFAULT (MVP Scope):
    /// If a member has already received their circle payout pot in an earlier round before
    /// defaulting in a later round, forfeiting their 1x stake only recovers 1 round of contribution.
    /// The remaining uncollected rounds leave an uncovered shortfall that is absorbed by the
    /// group in this MVP design. This is intentional scope for the MVP.
    pub fn process_default(ctx: Context<ProcessDefault>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        require!(circle.status == CircleStatus::Active, KoloError::CircleNotActive);
        require!(!member.has_defaulted, KoloError::MemberDefaulted);
        require!(member.last_contributed_round != circle.current_round, KoloError::AlreadyContributedThisRound);

        // caller_member is derived from the caller's pubkey and constrained to
        // this circle, which already enforces that the caller is a member.
        let _ = &ctx.accounts.caller_member;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let regular_deadline = circle.current_round_start.checked_add(circle.frequency).ok_or(KoloError::MathOverflow)?;

        let grace_deadline = if member.grace_period_started_at > 0 {
            member.grace_period_started_at.checked_add(circle.grace_period_duration).ok_or(KoloError::MathOverflow)?
        } else {
            regular_deadline.checked_add(circle.grace_period_duration).ok_or(KoloError::MathOverflow)?
        };

        require!(now > grace_deadline, KoloError::GracePeriodNotExpired);

        // Forfeit member's locked stake into current round pool
        circle.current_round_forfeited_pool = circle.current_round_forfeited_pool
            .checked_add(member.stake_amount)
            .ok_or(KoloError::MathOverflow)?;
        circle.defaulted_count = circle.defaulted_count.checked_add(1).ok_or(KoloError::MathOverflow)?;

        member.stake_amount = 0;
        member.is_staked = false;
        member.has_defaulted = true;
        member.grace_period_started_at = 0;

        Ok(())
    }

    /// Releases the current round's collected pot (contributions + forfeited stakes) to the next non-defaulted member.
    pub fn release_payout(ctx: Context<ReleasePayout>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        let recipient_member = &mut ctx.accounts.recipient_member;

        require!(circle.status == CircleStatus::Active, KoloError::CircleNotActive);
        require!(!recipient_member.has_defaulted, KoloError::RecipientDefaulted);
        require!(!recipient_member.has_received_payout, KoloError::RecipientAlreadyReceivedPayout);

        // Find the next eligible member in payout_order, skipping defaulted members
        let mut target_index: Option<usize> = None;
        for i in (circle.current_round as usize)..circle.payout_order.len() {
            if circle.payout_order[i] == recipient_member.wallet {
                target_index = Some(i);
                break;
            }
        }

        require!(target_index.is_some(), KoloError::InvalidPayoutRecipient);

        // The round pot can only be released once the round deadline has passed.
        let deadline = circle.current_round_start
            .checked_add(circle.frequency)
            .ok_or(KoloError::MathOverflow)?;
        let clock = Clock::get()?;
        require!(clock.unix_timestamp >= deadline, KoloError::RoundDeadlineNotReached);

        // The pot must be fully subscribed before it can be released. Members who
        // have already defaulted in a previous round cannot re-contribute, so the
        // expected total excludes them (their 1x stake was forfeited and paid out
        // in the round they defaulted, and is no longer owed).
        let payout_total = circle.current_round_collected
            .checked_add(circle.current_round_forfeited_pool)
            .ok_or(KoloError::MathOverflow)?;

        let active_member_count = (circle.member_count as u64)
            .checked_sub(circle.defaulted_count as u64)
            .ok_or(KoloError::MathOverflow)?;
        let expected_round_total = active_member_count
            .checked_mul(circle.contribution_amount)
            .ok_or(KoloError::MathOverflow)?;
        require!(payout_total >= expected_round_total, KoloError::RoundPotIncomplete);

        require!(payout_total > 0, KoloError::NoFundsToPayout);

        // Transfer pot from circle vault to recipient
        let circle_key = circle.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            circle_key.as_ref(),
            &[circle.vault_bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            payout_total,
        )?;

        recipient_member.has_received_payout = true;

        // Reset round pools. defaulted_count is cumulative across the circle's
        // lifetime (a defaulted member can never re-contribute), so it is NOT reset.
        circle.current_round_collected = 0;
        circle.current_round_forfeited_pool = 0;
        circle.current_round_contributor_count = 0;

        // Advance to next round
        circle.current_round += 1;
        let clock = Clock::get()?;
        circle.current_round_start = clock.unix_timestamp;

        // If all rounds are completed, transition status to Completed
        if circle.current_round >= circle.max_members {
            circle.status = CircleStatus::Completed;
        }

        Ok(())
    }

    /// Refunds the original collateral stake to a non-defaulted member after all circle rounds complete.
    pub fn complete_circle(ctx: Context<CompleteCircle>) -> Result<()> {
        let circle = &ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        require!(circle.status == CircleStatus::Completed, KoloError::CircleNotCompleted);
        require!(!member.has_defaulted, KoloError::MemberDefaulted);
        require!(!member.stake_refunded, KoloError::StakeAlreadyRefunded);
        require!(member.is_staked && member.stake_amount > 0, KoloError::NoStakeToRefund);

        let refund_amount = member.stake_amount;

        // Transfer collateral stake refund from vault to member
        let circle_key = circle.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            circle_key.as_ref(),
            &[circle.vault_bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.member_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            refund_amount,
        )?;

        member.stake_refunded = true;
        member.is_staked = false;
        member.stake_amount = 0;

        Ok(())
    }

    /// Cancels a forming circle before all seats fill; only callable by the creator.
    pub fn cancel_circle(ctx: Context<CancelCircle>) -> Result<()> {
        let circle = &mut ctx.accounts.circle;
        require!(circle.status == CircleStatus::Forming, KoloError::CircleNotForming);
        require!(circle.creator == ctx.accounts.creator.key(), KoloError::Unauthorized);

        circle.status = CircleStatus::Cancelled;
        Ok(())
    }

    /// Allows a member who joined a cancelled circle to reclaim their locked stake.
    pub fn refund_cancelled_stake(ctx: Context<RefundCancelledStake>) -> Result<()> {
        let circle = &ctx.accounts.circle;
        let member = &mut ctx.accounts.member;

        require!(circle.status == CircleStatus::Cancelled, KoloError::CircleNotCancelled);
        require!(member.is_staked && member.stake_amount > 0, KoloError::NoStakeToRefund);
        require!(!member.stake_refunded, KoloError::StakeAlreadyRefunded);

        let refund_amount = member.stake_amount;

        let circle_key = circle.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            circle_key.as_ref(),
            &[circle.vault_bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.member_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            refund_amount,
        )?;

        member.stake_refunded = true;
        member.is_staked = false;
        member.stake_amount = 0;

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Account Contexts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(circle_id: u64)]
pub struct CreateCircle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Circle::INIT_SPACE,
        seeds = [b"circle", creator.key().as_ref(), circle_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = creator,
        seeds = [b"vault", circle.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct JoinCircle<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = member_wallet,
        space = 8 + Member::INIT_SPACE,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump,
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"vault", circle.key().as_ref()],
        bump = circle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token_account.owner == member_wallet.key(),
        constraint = member_token_account.mint == circle.usdc_mint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key(),
        constraint = member.circle == circle.key(),
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"vault", circle.key().as_ref()],
        bump = circle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token_account.owner == member_wallet.key(),
        constraint = member_token_account.mint == circle.usdc_mint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct HandleLatePayment<'info> {
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"member", circle.key().as_ref(), caller.key().as_ref()],
        bump,
        constraint = caller_member.circle == circle.key(),
        constraint = caller_member.wallet == caller.key(),
    )]
    pub caller_member: Account<'info, Member>,

    #[account(
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = member.circle == circle.key(),
    )]
    pub member: Account<'info, Member>,
}

#[derive(Accounts)]
pub struct ProcessDefault<'info> {
    pub caller: Signer<'info>,

    #[account(
        seeds = [b"member", circle.key().as_ref(), caller.key().as_ref()],
        bump,
        constraint = caller_member.circle == circle.key(),
        constraint = caller_member.wallet == caller.key(),
    )]
    pub caller_member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump,
        constraint = member.circle == circle.key(),
    )]
    pub member: Account<'info, Member>,
}

#[derive(Accounts)]
pub struct ReleasePayout<'info> {
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), recipient_member.wallet.as_ref()],
        bump = recipient_member.bump,
        constraint = recipient_member.circle == circle.key(),
    )]
    pub recipient_member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"vault", circle.key().as_ref()],
        bump = circle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient_member.wallet,
        constraint = recipient_token_account.mint == circle.usdc_mint,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CompleteCircle<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key(),
        constraint = member.circle == circle.key(),
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"vault", circle.key().as_ref()],
        bump = circle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token_account.owner == member_wallet.key(),
        constraint = member_token_account.mint == circle.usdc_mint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelCircle<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"circle", creator.key().as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,
}

#[derive(Accounts)]
pub struct RefundCancelledStake<'info> {
    #[account(mut)]
    pub member_wallet: Signer<'info>,

    #[account(
        seeds = [b"circle", circle.creator.as_ref(), circle.circle_id.to_le_bytes().as_ref()],
        bump = circle.bump,
    )]
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [b"member", circle.key().as_ref(), member_wallet.key().as_ref()],
        bump = member.bump,
        constraint = member.wallet == member_wallet.key(),
        constraint = member.circle == circle.key(),
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        seeds = [b"vault", circle.key().as_ref()],
        bump = circle.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = member_token_account.owner == member_wallet.key(),
        constraint = member_token_account.mint == circle.usdc_mint,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// -----------------------------------------------------------------------------
// State Structures
// -----------------------------------------------------------------------------

#[account]
    #[derive(InitSpace)]
    pub struct Circle {
        pub creator: Pubkey,
        pub circle_id: u64,
        pub contribution_amount: u64,
        pub frequency: i64,
        pub grace_period_duration: i64,
        pub late_fee_bps: u16,
        pub max_members: u8,
        pub member_count: u8,
        pub current_round: u8,
        pub status: CircleStatus,
        pub current_round_start: i64,
        pub usdc_mint: Pubkey,
        pub bump: u8,
        pub vault_bump: u8,
        #[max_len(16)]
        pub payout_order: Vec<Pubkey>,
        pub current_round_collected: u64,
        pub current_round_forfeited_pool: u64,
        pub current_round_contributor_count: u8,
        pub defaulted_count: u8,
    }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum CircleStatus {
    Forming,
    Active,
    Completed,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub wallet: Pubkey,
    pub circle: Pubkey,
    pub stake_amount: u64,
    pub is_staked: bool,
    pub contributions_paid: u8,
    pub last_contributed_round: u8,
    pub has_defaulted: bool,
    pub has_received_payout: bool,
    pub grace_period_started_at: i64,
    pub stake_refunded: bool,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// Error Codes
// -----------------------------------------------------------------------------

#[error_code]
pub enum KoloError {
    #[msg("Invalid member count. Must be between 2 and 16.")]
    InvalidMemberCount,
    #[msg("Invalid contribution amount.")]
    InvalidContributionAmount,
    #[msg("Invalid frequency.")]
    InvalidFrequency,
    #[msg("Invalid payout order.")]
    InvalidPayoutOrder,
    #[msg("Circle is not forming.")]
    CircleNotForming,
    #[msg("Circle is full.")]
    CircleFull,
    #[msg("Circle is not active.")]
    CircleNotActive,
    #[msg("Circle is not completed.")]
    CircleNotCompleted,
    #[msg("Circle is not cancelled.")]
    CircleNotCancelled,
    #[msg("Member has defaulted.")]
    MemberDefaulted,
    #[msg("Already contributed for this round.")]
    AlreadyContributedThisRound,
    #[msg("Round deadline has not passed yet.")]
    RoundDeadlineNotPassed,
    #[msg("Grace period already started.")]
    GracePeriodAlreadyStarted,
    #[msg("Grace period has expired. Member must be processed for default.")]
    GracePeriodExpired,
    #[msg("Grace period has not expired yet.")]
    GracePeriodNotExpired,
    #[msg("Recipient has defaulted.")]
    RecipientDefaulted,
    #[msg("Recipient already received payout.")]
    RecipientAlreadyReceivedPayout,
    #[msg("Recipient is not the expected payout recipient.")]
    InvalidPayoutRecipient,
    #[msg("No funds available to payout.")]
    NoFundsToPayout,
    #[msg("Round deadline has not been reached yet.")]
    RoundDeadlineNotReached,
    #[msg("Not all members have contributed for this round yet.")]
    RoundPotIncomplete,
    #[msg("Stake has already been refunded.")]
    StakeAlreadyRefunded,
    #[msg("No stake available to refund.")]
    NoStakeToRefund,
    #[msg("Unauthorized action.")]
    Unauthorized,
    #[msg("Math overflow.")]
    MathOverflow,
}
